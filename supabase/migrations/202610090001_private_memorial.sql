-- Apply through a trusted Supabase migration / SQL operator. Never run as a browser user.
-- Application authorization also requires SUPABASE_OWNER_ID to match the profile below.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  singleton boolean not null default true unique check (singleton),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
create policy profile_self_read on public.profiles for select to authenticated using (id = (select auth.uid()));

-- SECURITY INVOKER deliberately preserves profiles RLS and cannot change the allowlist.
create function public.is_allowed_owner() returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()))
$$;
revoke all on function public.is_allowed_owner() from public, anon;
grant execute on function public.is_allowed_owner() to authenticated;

create function public.valid_scopes(value jsonb) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select case when jsonb_typeof(value) <> 'array' then false else
    jsonb_array_length(value) <= 7 and not exists (
      select 1 from jsonb_array_elements(value) x where jsonb_typeof(x) <> 'string'
      or x #>> '{}' not in ('metadata_only','personal_collection','private_storage','private_playback','official_embed','public_display','link_only')
    ) end
$$;
revoke all on function public.valid_scopes(jsonb) from public, anon;
grant execute on function public.valid_scopes(jsonb) to authenticated;

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  kind text not null check (kind in ('music','albums','videos','photos','journey','timeline','concerts','letters','journal','milestones','memory-book')),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 262144),
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id)
);
create index entries_owner_kind_updated on public.entries(owner_id,kind,updated_at desc);
create index entries_owner_year on public.entries(owner_id,((data->>'year')));
create index entries_search on public.entries using gin(to_tsvector('simple',title || ' ' || coalesce(data->>'description','') || ' ' || coalesce(data->>'notes','')));

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  filename text not null check (char_length(filename) between 1 and 255 and filename !~ '[/\\]'),
  mime_type text not null,
  size bigint not null check (size > 0 and size <= 104857600),
  media_type text not null check (media_type in ('image','audio','video')),
  storage_path text not null unique,
  source_url text check (source_url is null or source_url ~ '^https?://'),
  rights_holder text check (char_length(rights_holder) <= 1000),
  rights_status text not null check (rights_status in ('unknown','personal_only','licensed','do_not_publish')),
  license_type text check (char_length(license_type) <= 1000),
  license_notes text check (char_length(license_notes) <= 10000),
  attribution text check (char_length(attribution) <= 10000),
  allowed_use_scope jsonb not null default '[]'::jsonb check (public.valid_scopes(allowed_use_scope)),
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  check (storage_path ~ ('^' || owner_id::text || '/' || id::text || '\.(jpg|jpeg|png|webp|gif|avif|mp3|wav|ogg|flac|m4a|mp4|webm)$')),
  check ((media_type = 'image' and mime_type in ('image/jpeg','image/png','image/webp','image/gif','image/avif'))
    or (media_type = 'audio' and mime_type in ('audio/mpeg','audio/wav','audio/ogg','audio/flac','audio/mp4'))
    or (media_type = 'video' and mime_type in ('video/mp4','video/webm'))),
  check (rights_status in ('personal_only','licensed') and allowed_use_scope ? 'private_storage'
    and rights_holder is not null and license_notes is not null
    and char_length(btrim(rights_holder)) > 0 and char_length(btrim(license_notes)) > 0)
);
create index media_assets_owner_created on public.media_assets(owner_id,created_at desc);

create table public.site_settings (
  owner_id uuid primary key references public.profiles(id) on delete restrict,
  settings jsonb not null check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 65536),
  updated_at timestamptz not null default now()
);

create function public.guard_record_identity() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id then raise exception 'owner_id is immutable' using errcode = '42501'; end if;
  if tg_table_name in ('entries','media_assets') then
    if new.id is distinct from old.id then raise exception 'id is immutable' using errcode = '23514'; end if;
  end if;
  if tg_table_name = 'entries' then
    if new.kind is distinct from old.kind then raise exception 'entry kind is immutable' using errcode = '23514'; end if;
  end if;
  if tg_table_name = 'media_assets' then
    if new.media_type is distinct from old.media_type or new.storage_path is distinct from old.storage_path
      or new.mime_type is distinct from old.mime_type or new.size is distinct from old.size then
      raise exception 'uploaded file identity is immutable; upload a replacement asset' using errcode = '23514'; end if;
  end if;
  if tg_table_name <> 'media_assets' then new.updated_at := now(); end if;
  return new;
end $$;
create trigger entries_identity before update on public.entries for each row execute function public.guard_record_identity();
create trigger media_identity before update on public.media_assets for each row execute function public.guard_record_identity();
create trigger settings_identity before update on public.site_settings for each row execute function public.guard_record_identity();

create function public.valid_partial_date(value text) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare actual date;
begin
  if value='' then return true; end if;
  if value !~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$' or substring(value,1,4)::int not between 1900 and 2200 then return false; end if;
  actual := (value || case length(value) when 4 then '-01-01' when 7 then '-01' else '' end)::date;
  return actual is not null;
exception when others then return false;
end $$;
revoke all on function public.valid_partial_date(text) from public,anon;
grant execute on function public.valid_partial_date(text) to authenticated;

create function public.validate_entry_fields() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare k text; v jsonb;
begin
  for k,v in select key,value from jsonb_each(new.data) loop
    if k not in ('description','notes','date','datePrecision','year','category','tags','artist','albumId','assetId','coverAssetId',
      'externalUrl','sourceType','sourceUrl','rightsHolder','rightsStatus','licenseType','licenseNotes','attribution','allowedUseScope',
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
    elsif jsonb_typeof(v) <> 'string' then raise exception '% must be a string',k using errcode = '23514';
    end if;
  end loop;
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
create trigger entries_fields before insert or update on public.entries for each row execute function public.validate_entry_fields();

-- Deferred relationship checks permit an atomic restore whose children precede parents.
create function public.validate_entry_relationships() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare row_data jsonb; ref text; k text; expected_type text;
begin
  if tg_op = 'DELETE' then
    if exists(select 1 from public.entries e where e.owner_id=old.owner_id and
      (e.data->>'albumId'=old.id::text or coalesce(e.data->'relatedIds','[]') ? old.id::text
      or coalesce(e.data->'itemIds','[]') ? old.id::text or coalesce(e.data->'chapters','[]') ? old.id::text)) then
      raise exception 'entry still referenced; remove relationships first' using errcode='23503';
    end if;
    if exists(select 1 from public.site_settings s where s.owner_id=old.owner_id and coalesce(s.settings->'featuredIds','[]') ? old.id::text) then
      raise exception 'entry still featured; update settings first' using errcode='23503'; end if;
    return null;
  end if;
  -- A later update/delete in the same transaction may have replaced this NEW value.
  select data into row_data from public.entries where id=new.id and owner_id=new.owner_id;
  if not found then return null; end if;
  if coalesce(row_data->>'albumId','') <> '' and not exists(select 1 from public.entries e
    where e.id::text=row_data->>'albumId' and e.owner_id=new.owner_id and e.kind='albums') then
    raise exception 'album relation missing or outside owner' using errcode='23503'; end if;
  foreach k in array array['relatedIds','itemIds','chapters'] loop
    for ref in select jsonb_array_elements_text(coalesce(row_data->k,'[]')) loop
      if ref=new.id::text or not exists(select 1 from public.entries e where e.id::text=ref and e.owner_id=new.owner_id
        and (k<>'chapters' or e.kind='journey')) then
        raise exception 'entry relationship missing or outside owner' using errcode='23503'; end if;
    end loop;
  end loop;
  foreach k in array array['assetId','coverAssetId'] loop
    ref := row_data->>k;
    if coalesce(ref,'') <> '' then
      expected_type := case when k='coverAssetId' or new.kind='photos' then 'image'
        when new.kind='music' then 'audio' when new.kind='videos' then 'video' else null end;
      if not exists(select 1 from public.media_assets a where a.id::text=ref and a.owner_id=new.owner_id
        and (expected_type is null or a.media_type=expected_type)
        and (k<>'assetId' or new.kind not in ('music','videos') or a.allowed_use_scope ? 'private_playback')) then
        raise exception 'media relationship missing, wrong type, or outside owner' using errcode='23503'; end if;
    end if;
  end loop;
  return null;
end $$;
create constraint trigger entries_relationships after insert or update or delete on public.entries
  deferrable initially deferred for each row execute function public.validate_entry_relationships();

create function public.validate_settings_fields() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare k text; v jsonb; scope text;
begin
  for k,v in select key,value from jsonb_each(new.settings) loop
    if k not in ('siteName','subtitle','startYear','animation','theme','timezone','heroAssetId','mobileHeroAssetId','heroPosition',
      'moduleOrder','hiddenModules','featuredIds','imageLimitMb','audioLimitMb','videoLimitMb') then
      raise exception 'unsupported settings field: %',k using errcode='23514'; end if;
    if k in ('moduleOrder','hiddenModules','featuredIds') then
      if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>500 then raise exception 'invalid settings array' using errcode='23514'; end if;
      for scope in select jsonb_array_elements_text(v) loop
        if k<>'featuredIds' and scope not in ('journey','music','videos','photos','journal','concerts','star-map') then
          raise exception 'unknown homepage module' using errcode='23514'; end if;
      end loop;
    elsif k='animation' then
      if jsonb_typeof(v)<>'boolean' then raise exception 'animation must be boolean' using errcode='23514'; end if;
    elsif k in ('startYear','imageLimitMb','audioLimitMb','videoLimitMb') then
      if not(k='startYear' and v='null'::jsonb) and (jsonb_typeof(v)<>'number' or v::text !~ '^[0-9]+$') then
        raise exception 'invalid settings number' using errcode='23514'; end if;
    elsif jsonb_typeof(v)<>'string' then raise exception 'settings field must be text' using errcode='23514'; end if;
  end loop;
  if new.settings ? 'theme' and new.settings->>'theme' not in ('midnight','paper') then raise exception 'invalid theme' using errcode='23514'; end if;
  if new.settings ? 'heroPosition' and new.settings->>'heroPosition' not in ('center','top','bottom','left','right') then raise exception 'invalid hero position' using errcode='23514'; end if;
  foreach k in array array['imageLimitMb','audioLimitMb','videoLimitMb'] loop
    if new.settings ? k and (new.settings->>k)::int not between 1 and (case k when 'imageLimitMb' then 100 when 'audioLimitMb' then 500 else 2048 end) then
      raise exception 'invalid upload setting' using errcode='23514'; end if;
  end loop;
  return new;
end $$;
create trigger settings_fields before insert or update on public.site_settings for each row execute function public.validate_settings_fields();

create function public.validate_settings_relationships() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare ref text; k text; cfg jsonb;
begin
  select settings into cfg from public.site_settings where owner_id=new.owner_id;
  if not found then return null; end if;
  if cfg ? 'startYear' and cfg->'startYear' <> 'null'::jsonb and
    (jsonb_typeof(cfg->'startYear') <> 'number' or cfg->>'startYear' !~ '^[0-9]{4}$' or (cfg->>'startYear')::int not between 1900 and 2200) then
    raise exception 'invalid start year' using errcode='23514'; end if;
  foreach k in array array['heroAssetId','mobileHeroAssetId'] loop
    ref := cfg->>k;
    if coalesce(ref,'') <> '' and not exists(select 1 from public.media_assets a where a.id::text=ref and a.owner_id=new.owner_id and a.media_type='image') then
      raise exception 'hero image missing or outside owner' using errcode='23503'; end if;
  end loop;
  if cfg ? 'featuredIds' then
    if jsonb_typeof(cfg->'featuredIds') <> 'array' then raise exception 'featuredIds must be an array' using errcode='23514'; end if;
    for ref in select jsonb_array_elements_text(cfg->'featuredIds') loop
      if not exists(select 1 from public.entries e where e.id::text=ref and e.owner_id=new.owner_id) then
        raise exception 'featured entry missing or outside owner' using errcode='23503'; end if;
    end loop;
  end if;
  return null;
end $$;
create constraint trigger settings_relationships after insert or update on public.site_settings
  deferrable initially deferred for each row execute function public.validate_settings_relationships();

create function public.prevent_referenced_asset_delete() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.entries e where e.owner_id=old.owner_id and (e.data->>'assetId'=old.id::text or e.data->>'coverAssetId'=old.id::text))
    or exists(select 1 from public.site_settings s where s.owner_id=old.owner_id and (s.settings->>'heroAssetId'=old.id::text or s.settings->>'mobileHeroAssetId'=old.id::text)) then
    raise exception 'asset still referenced; remove relationships first' using errcode='23503'; end if;
  return null;
end $$;
create constraint trigger media_references after delete on public.media_assets
  deferrable initially deferred for each row execute function public.prevent_referenced_asset_delete();

create function public.validate_media_playback_scope() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare scopes jsonb;
begin
  select allowed_use_scope into scopes from public.media_assets where id=new.id and owner_id=new.owner_id;
  if found and not(scopes ? 'private_playback') and exists(select 1 from public.entries e
    where e.owner_id=new.owner_id and e.kind in ('music','videos') and e.data->>'assetId'=new.id::text) then
    raise exception 'remove playback relationships before revoking playback scope' using errcode='23514'; end if;
  return null;
end $$;
create constraint trigger media_playback_scope after insert or update on public.media_assets
  deferrable initially deferred for each row execute function public.validate_media_playback_scope();

create function public.validate_stored_media_object() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare current_asset public.media_assets%rowtype;
begin
  select * into current_asset from public.media_assets where id=new.id and owner_id=new.owner_id;
  if found and not exists(select 1 from storage.objects o where o.bucket_id='private-media'
    and o.name=current_asset.storage_path and o.owner_id=current_asset.owner_id::text
    and o.metadata->>'size'=current_asset.size::text) then
    raise exception 'private storage file missing or size does not match metadata' using errcode='23503'; end if;
  return null;
end $$;
create constraint trigger media_storage_object after insert or update on public.media_assets
  deferrable initially deferred for each row execute function public.validate_stored_media_object();

alter table public.entries enable row level security;
alter table public.entries force row level security;
alter table public.media_assets enable row level security;
alter table public.media_assets force row level security;
alter table public.site_settings enable row level security;
alter table public.site_settings force row level security;
revoke all on public.entries,public.media_assets,public.site_settings from anon,authenticated;
grant select,insert,update,delete on public.entries,public.media_assets,public.site_settings to authenticated;

create policy entries_read on public.entries for select to authenticated using (owner_id=(select auth.uid()) and (select public.is_allowed_owner()));
create policy entries_insert on public.entries for insert to authenticated with check (owner_id=(select auth.uid()) and (select public.is_allowed_owner()));
create policy entries_update on public.entries for update to authenticated using (owner_id=(select auth.uid()) and (select public.is_allowed_owner())) with check (owner_id=(select auth.uid()) and (select public.is_allowed_owner()));
create policy entries_delete on public.entries for delete to authenticated using (owner_id=(select auth.uid()) and (select public.is_allowed_owner()));
create policy media_read on public.media_assets for select to authenticated using (owner_id=(select auth.uid()) and (select public.is_allowed_owner()));
create policy media_insert on public.media_assets for insert to authenticated with check (owner_id=(select auth.uid()) and (select public.is_allowed_owner()));
create policy media_update on public.media_assets for update to authenticated using (owner_id=(select auth.uid()) and (select public.is_allowed_owner())) with check (owner_id=(select auth.uid()) and (select public.is_allowed_owner()));
create policy media_delete on public.media_assets for delete to authenticated using (owner_id=(select auth.uid()) and (select public.is_allowed_owner()));
create policy settings_read on public.site_settings for select to authenticated using (owner_id=(select auth.uid()) and (select public.is_allowed_owner()));
create policy settings_insert on public.site_settings for insert to authenticated with check (owner_id=(select auth.uid()) and (select public.is_allowed_owner()));
create policy settings_update on public.site_settings for update to authenticated using (owner_id=(select auth.uid()) and (select public.is_allowed_owner())) with check (owner_id=(select auth.uid()) and (select public.is_allowed_owner()));
create policy settings_delete on public.site_settings for delete to authenticated using (owner_id=(select auth.uid()) and (select public.is_allowed_owner()));

-- This RPC is one transaction, uses caller RLS, never replaces the owner's entire database.
create function public.restore_backup(p_entries jsonb, p_settings jsonb, p_assets jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare caller uuid := auth.uid(); item jsonb; incoming_id uuid; count_entries int := 0; count_assets int := 0;
begin
  if caller is null or not public.is_allowed_owner() then raise exception 'owner authorization required' using errcode='42501'; end if;
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_typeof(p_assets) is distinct from 'array' or jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'invalid backup structure' using errcode='23514'; end if;
  if jsonb_array_length(p_entries)>10000 or jsonb_array_length(p_assets)>10000 then raise exception 'backup too large' using errcode='23514'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) x group by x->>'id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_assets) x group by x->>'id' having count(*)>1) then
    raise exception 'duplicate backup IDs' using errcode='23514'; end if;
  -- Prevent forged owner fields, including IDs that already belong to a different owner.
  for item in select value from jsonb_array_elements(p_assets) loop
    if item->>'owner_id' is distinct from caller::text then raise exception 'backup owner mismatch' using errcode='42501'; end if;
    incoming_id := (item->>'id')::uuid;
    insert into public.media_assets(id,owner_id,filename,mime_type,size,media_type,storage_path,source_url,rights_holder,rights_status,license_type,license_notes,attribution,allowed_use_scope,created_at)
      values(incoming_id,caller,item->>'filename',item->>'mime_type',(item->>'size')::bigint,item->>'media_type',item->>'storage_path',
        nullif(item->>'source_url',''),item->>'rights_holder',item->>'rights_status',item->>'license_type',item->>'license_notes',
        item->>'attribution',item->'allowed_use_scope',coalesce((item->>'created_at')::timestamptz,now()))
      on conflict(id) do update set filename=excluded.filename,mime_type=excluded.mime_type,size=excluded.size,
        media_type=excluded.media_type,storage_path=excluded.storage_path,source_url=excluded.source_url,rights_holder=excluded.rights_holder,
        rights_status=excluded.rights_status,license_type=excluded.license_type,license_notes=excluded.license_notes,
        attribution=excluded.attribution,allowed_use_scope=excluded.allowed_use_scope;
    -- An invisible conflicting row causes RLS to reject UPDATE, rather than taking ownership.
    count_assets := count_assets+1;
  end loop;
  for item in select value from jsonb_array_elements(p_entries) loop
    if item->>'owner_id' is distinct from caller::text then raise exception 'backup owner mismatch' using errcode='42501'; end if;
    incoming_id := (item->>'id')::uuid;
    insert into public.entries(id,owner_id,kind,title,data,favorite,created_at,updated_at)
      values(incoming_id,caller,item->>'kind',item->>'title',item->'data',coalesce((item->>'favorite')::boolean,false),
        coalesce((item->>'created_at')::timestamptz,now()),coalesce((item->>'updated_at')::timestamptz,now()))
      on conflict(id) do update set kind=excluded.kind,title=excluded.title,data=excluded.data,favorite=excluded.favorite;
    count_entries := count_entries+1;
  end loop;
  insert into public.site_settings(owner_id,settings) values(caller,p_settings)
    on conflict(owner_id) do update set settings=excluded.settings;
  -- Surface deferred relationship errors before a successful RPC result can be returned.
  set constraints all immediate;
  return jsonb_build_object('entries',count_entries,'assets',count_assets,'settingsUpdated',true);
end $$;
revoke all on function public.restore_backup(jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.restore_backup(jsonb,jsonb,jsonb) to authenticated;

-- No helper is a privilege escalation entrypoint; trigger helpers are not callable RPCs.
revoke all on function public.guard_record_identity(),public.validate_entry_fields(),public.validate_entry_relationships(),
  public.validate_settings_fields(),public.validate_settings_relationships(),public.prevent_referenced_asset_delete(),
  public.validate_media_playback_scope(),public.validate_stored_media_object() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('private-media','private-media',false,104857600,array['image/jpeg','image/png','image/webp','image/gif','image/avif','audio/mpeg','audio/wav','audio/ogg','audio/flac','audio/mp4','video/mp4','video/webm'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy private_media_read on storage.objects for select to authenticated
  using(bucket_id='private-media' and (select public.is_allowed_owner()) and owner_id=(select auth.uid()::text)
    and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy private_media_insert on storage.objects for insert to authenticated
  with check(bucket_id='private-media' and (select public.is_allowed_owner()) and owner_id=(select auth.uid()::text)
    and name ~ ('^' || (select auth.uid()::text) || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|avif|mp3|wav|ogg|flac|m4a|mp4|webm)$'));
create policy private_media_replace on storage.objects for update to authenticated
  using(bucket_id='private-media' and (select public.is_allowed_owner()) and owner_id=(select auth.uid()::text)
    and (storage.foldername(name))[1]=(select auth.uid()::text)
    and not exists(select 1 from public.media_assets a where a.owner_id=(select auth.uid()) and a.storage_path=name))
  with check(bucket_id='private-media' and (select public.is_allowed_owner()) and owner_id=(select auth.uid()::text)
    and name ~ ('^' || (select auth.uid()::text) || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|avif|mp3|wav|ogg|flac|m4a|mp4|webm)$')
    and not exists(select 1 from public.media_assets a where a.owner_id=(select auth.uid()) and a.storage_path=name));
create policy private_media_delete on storage.objects for delete to authenticated
  using(bucket_id='private-media' and (select public.is_allowed_owner()) and owner_id=(select auth.uid()::text)
    and (storage.foldername(name))[1]=(select auth.uid()::text)
    and not exists(select 1 from public.media_assets a where a.owner_id=(select auth.uid()) and a.storage_path=name));

-- Provision explicitly AFTER Auth user creation. Replace the UUID in a trusted SQL session:
-- insert into public.profiles(id) values ('YOUR-AUTH-OWNER-UUID');
-- Never grant profile INSERT/UPDATE/DELETE to authenticated or enable public signup.
commit;
