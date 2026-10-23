-- Upgrade the existing archive in place. Publication flags and record IDs remain
-- historical metadata; every read now requires the allowlisted owner.
begin;

drop policy if exists media_public_selected_read on public.media_assets;
drop policy if exists private_media_selected_public_read on storage.objects;
-- Cloud uploads use new paths and signed upload URLs with upsert=false. Prevent
-- an object from changing between completion validation and metadata insertion.
drop policy if exists private_media_replace on storage.objects;

-- Table-level REVOKE does not remove the old per-column SELECT grants.
revoke all on public.media_assets from public,anon;
revoke select (id,owner_id,filename,mime_type,size,media_type,storage_path,created_at)
  on public.media_assets from public,anon;
revoke all on public.public_entries,public.public_site_settings from public,anon,authenticated;
-- Preserve view compatibility for the owner without their old definer privileges.
alter view public.public_entries set (security_invoker = true);
alter view public.public_site_settings set (security_invoker = true);
grant select on public.public_entries,public.public_site_settings to authenticated;
update storage.buckets set public=false where id='private-media';

-- Match the application's supported fields, including signed lyric offsets.
create or replace function public.validate_entry_fields() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare k text; v jsonb;
begin
  for k,v in select key,value from jsonb_each(new.data) loop
    if k not in ('description','notes','date','datePrecision','year','category','tags','artist','albumId','lyrics','lyricsOffset',
      'assetId','coverAssetId','externalUrl','sourceType','sourceUrl','rightsHolder','rightsStatus','licenseType','licenseNotes','attribution','allowedUseScope',
      'city','venue','attendance','mood','lifeStage','relatedIds','featured','verified','featuredOrder','status','itemIds','chapters','scheduledDate') then
      raise exception 'unsupported data field: %', k using errcode = '23514';
    end if;
    if k in ('tags','relatedIds','itemIds','chapters','allowedUseScope') then
      if jsonb_typeof(v) <> 'array' then raise exception '% must be an array', k using errcode = '23514'; end if;
      if exists(select 1 from jsonb_array_elements(v) a where jsonb_typeof(a) <> 'string') then
        raise exception '% must contain strings', k using errcode = '23514'; end if;
      if jsonb_array_length(v) > 500 then raise exception 'too many values in %',k using errcode = '23514'; end if;
    elsif k in ('featured','verified') then
      if jsonb_typeof(v) <> 'boolean' then raise exception '% must be boolean',k using errcode = '23514'; end if;
    elsif k in ('year','featuredOrder') then
      if jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]+$' then raise exception '% must be an integer',k using errcode = '23514'; end if;
    elsif k='lyricsOffset' then
      if jsonb_typeof(v) <> 'number' or v::text !~ '^-?[0-9]+$' then
        raise exception 'lyricsOffset must be an integer' using errcode = '23514'; end if;
      if v::text::numeric not between -600000 and 600000 then
        raise exception 'lyricsOffset outside supported range' using errcode = '23514'; end if;
    elsif jsonb_typeof(v) <> 'string' then raise exception '% must be a string',k using errcode = '23514';
    end if;
  end loop;
  if new.data ? 'lyrics' and char_length(new.data->>'lyrics') > 100000 then raise exception 'lyrics outside supported length' using errcode='23514'; end if;
  if new.data ? 'year' and (new.data->>'year')::int not between 1900 and 2200 then raise exception 'year outside supported range' using errcode='23514'; end if;
  if new.data ? 'datePrecision' and new.data->>'datePrecision' not in ('day','month','year','unknown') then raise exception 'invalid date precision' using errcode='23514'; end if;
  if new.data ? 'sourceType' and new.data->>'sourceType' not in ('authorized_upload','official_embed','external_link') then raise exception 'invalid source type' using errcode='23514'; end if;
  if new.data ? 'rightsStatus' and new.data->>'rightsStatus' not in ('unknown','personal_only','licensed','do_not_publish') then raise exception 'invalid rights status' using errcode='23514'; end if;
  if new.data ? 'status' and new.data->>'status' not in ('draft','saved') then raise exception 'invalid status' using errcode='23514'; end if;
  if new.data ? 'allowedUseScope' and not public.valid_scopes(new.data->'allowedUseScope') then raise exception 'invalid usage scope' using errcode='23514'; end if;
  foreach k in array array['date','scheduledDate'] loop
    if new.data ? k and not public.valid_partial_date(new.data->>k) then raise exception 'invalid calendar date' using errcode='23514'; end if;
  end loop;
  if coalesce(new.data->>'date','') <> '' and coalesce(new.data->>'datePrecision','unknown') <> 'unknown' and
    length(new.data->>'date') <> (case new.data->>'datePrecision' when 'day' then 10 when 'month' then 7 when 'year' then 4 end) then
    raise exception 'date does not match precision' using errcode='23514'; end if;
  foreach k in array array['externalUrl','sourceUrl'] loop
    if new.data ? k and new.data->>k <> '' and new.data->>k !~ '^https?://' then raise exception 'only HTTP(S) source URLs are accepted' using errcode='23514'; end if;
  end loop;
  return new;
end $$;
revoke all on function public.validate_entry_fields() from public,anon,authenticated;

-- Store the expected identity before issuing a signed upload URL. No session,
-- refresh token, signed URL or service key belongs in this table.
create table if not exists public.media_upload_intents (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  filename text not null check (char_length(filename) between 1 and 255 and filename !~ '[/\\]'),
  mime_type text not null,
  size bigint not null check (size > 0 and size <= 104857600),
  media_type text not null check (media_type in ('image','audio','video')),
  storage_path text not null unique,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object' and octet_length(metadata::text) <= 65536),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  check (storage_path ~ ('^' || owner_id::text || '/' || id::text || '\.(jpg|jpeg|png|webp|gif|avif|mp3|wav|ogg|flac|m4a|mp4|webm)$')),
  check ((media_type='image' and mime_type in ('image/jpeg','image/png','image/webp','image/gif','image/avif'))
    or (media_type='audio' and mime_type in ('audio/mpeg','audio/wav','audio/ogg','audio/flac','audio/mp4'))
    or (media_type='video' and mime_type in ('video/mp4','video/webm')))
);
create index if not exists media_upload_intents_owner_expiry on public.media_upload_intents(owner_id,expires_at);

create or replace function public.validate_upload_intent_metadata() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare k text; v jsonb;
begin
  for k,v in select key,value from jsonb_each(new.metadata) loop
    if k not in ('sourceUrl','rightsHolder','rightsStatus','licenseType','licenseNotes','attribution','allowedUseScope') then
      raise exception 'unsupported upload metadata field: %',k using errcode='23514'; end if;
    if k='allowedUseScope' then
      if not public.valid_scopes(v) then raise exception 'invalid upload usage scope' using errcode='23514'; end if;
    else
      if jsonb_typeof(v)<>'string' then raise exception 'upload metadata % must be text',k using errcode='23514'; end if;
      if char_length(v #>> '{}') > (case k when 'licenseNotes' then 10000 when 'sourceUrl' then 2048 else 500 end) then
        raise exception 'upload metadata % is too long',k using errcode='23514'; end if;
    end if;
  end loop;
  if new.metadata ? 'rightsStatus' and new.metadata->>'rightsStatus' not in ('unknown','personal_only','licensed','do_not_publish') then
    raise exception 'invalid upload rights status' using errcode='23514'; end if;
  if coalesce(new.metadata->>'sourceUrl','')<>'' and new.metadata->>'sourceUrl' !~ '^https?://' then
    raise exception 'invalid upload source URL' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.validate_upload_intent_metadata() from public,anon,authenticated;
drop trigger if exists upload_intent_metadata on public.media_upload_intents;
create trigger upload_intent_metadata before insert or update on public.media_upload_intents
  for each row execute function public.validate_upload_intent_metadata();

alter table public.media_upload_intents enable row level security;
alter table public.media_upload_intents force row level security;
revoke all on public.media_upload_intents from public,anon,authenticated;
-- Expected upload identity is immutable to application users after INSERT.
grant select,insert,delete on public.media_upload_intents to authenticated;
drop policy if exists upload_intents_read on public.media_upload_intents;
drop policy if exists upload_intents_insert on public.media_upload_intents;
drop policy if exists upload_intents_delete on public.media_upload_intents;
create policy upload_intents_read on public.media_upload_intents for select to authenticated
  using(owner_id=(select auth.uid()) and (select public.is_allowed_owner()));
create policy upload_intents_insert on public.media_upload_intents for insert to authenticated
  with check(owner_id=(select auth.uid()) and (select public.is_allowed_owner()) and expires_at > now());
-- Expired uploads stay visible/deletable to their owner for safe orphan cleanup.
create policy upload_intents_delete on public.media_upload_intents for delete to authenticated
  using(owner_id=(select auth.uid()) and (select public.is_allowed_owner()));

-- Theme resources are not collection records. Fixed theme names and bounded
-- starsea filenames share an owner-private bucket, including the JSON manifest.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('private-theme','private-theme',false,12582912,array['image/jpeg','image/png','image/webp','application/json'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists private_theme_read on storage.objects;
drop policy if exists private_theme_insert on storage.objects;
drop policy if exists private_theme_delete on storage.objects;
create policy private_theme_read on storage.objects for select to authenticated
  using(bucket_id='private-theme' and (select public.is_allowed_owner()) and owner_id=(select auth.uid()::text)
    and name ~ ('^' || (select auth.uid()::text) || '/(theme-media/(stage\.jpg|beidou\.jpg|v-reference\.png)|starsea-v2/(manifest\.json|[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}\.(webp|png|jpe?g)))$'));
create policy private_theme_insert on storage.objects for insert to authenticated
  with check(bucket_id='private-theme' and (select public.is_allowed_owner()) and owner_id=(select auth.uid()::text)
    and name ~ ('^' || (select auth.uid()::text) || '/(theme-media/(stage\.jpg|beidou\.jpg|v-reference\.png)|starsea-v2/(manifest\.json|[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}\.(webp|png|jpe?g)))$'));
create policy private_theme_delete on storage.objects for delete to authenticated
  using(bucket_id='private-theme' and (select public.is_allowed_owner()) and owner_id=(select auth.uid()::text)
    and name ~ ('^' || (select auth.uid()::text) || '/(theme-media/(stage\.jpg|beidou\.jpg|v-reference\.png)|starsea-v2/(manifest\.json|[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}\.(webp|png|jpe?g)))$'));

commit;
