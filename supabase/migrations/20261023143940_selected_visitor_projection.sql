-- The owner may explicitly curate a visitor collection. Existing publication
-- choices are preserved; draft records and private metadata never enter it.
begin;

-- Projection views deliberately run as this constrained, non-login role, not
-- as postgres. Visitors receive no privileges on the underlying private tables.
-- The role has no bypassrls attribute and cannot write or enroll an owner.
do $$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='archive_visitor_projection') then
    create role archive_visitor_projection nologin noinherit nobypassrls;
  end if;
end $$;
alter role archive_visitor_projection nologin noinherit nobypassrls;
grant archive_visitor_projection to postgres;
revoke archive_visitor_projection from anon,authenticated,service_role;
grant usage,create on schema public to archive_visitor_projection;

create schema if not exists archive_public;
revoke all on schema archive_public from public,anon,authenticated,service_role;
grant usage,create on schema archive_public to archive_visitor_projection;
-- This schema contains only one bounded boolean helper, not private records or
-- auth configuration. It is not an exposed Data API schema.
grant usage on schema archive_public to anon,authenticated;

revoke all on public.entries,public.media_assets,public.site_settings,public.profiles from anon;
-- Remove historical per-column grants as well as table-level privileges.
revoke select(id,owner_id,filename,mime_type,size,media_type,storage_path,created_at)
  on public.media_assets from public,anon;
revoke all on public.entries,public.media_assets,public.site_settings,public.profiles
  from archive_visitor_projection;
grant select(id) on public.profiles to archive_visitor_projection;
grant select(id,owner_id,kind,title,data,is_public,created_at,updated_at)
  on public.entries to archive_visitor_projection;
grant select(id,owner_id,mime_type,size,media_type,storage_path,created_at)
  on public.media_assets to archive_visitor_projection;
grant select(owner_id,settings) on public.site_settings to archive_visitor_projection;

drop policy if exists visitor_projection_profile on public.profiles;
create policy visitor_projection_profile on public.profiles for select
  to archive_visitor_projection using(true);
drop policy if exists visitor_projection_entries on public.entries;
create policy visitor_projection_entries on public.entries for select
  to archive_visitor_projection using(
    is_public and coalesce(data->>'status','saved')<>'draft'
    and owner_id in (select p.id from public.profiles p)
  );
drop policy if exists visitor_projection_assets on public.media_assets;
create policy visitor_projection_assets on public.media_assets for select
  to archive_visitor_projection using(
    owner_id in (select p.id from public.profiles p)
    and exists(select 1 from public.entries e where e.owner_id=media_assets.owner_id
      and e.is_public and coalesce(e.data->>'status','saved')<>'draft'
      and media_assets.id::text in (e.data->>'assetId',e.data->>'coverAssetId'))
  );
drop policy if exists visitor_projection_settings on public.site_settings;
create policy visitor_projection_settings on public.site_settings for select
  to archive_visitor_projection using(owner_id in (select p.id from public.profiles p));

-- Replacing the historical views also removes their owner_id output. Their
-- definer role is intentionally subject to all the projection RLS above.
drop view if exists public.public_entries,public.public_site_settings,public.public_media_assets;
create view public.public_entries with (security_barrier=true,security_invoker=false) as
select e.id,e.kind,e.title,
  coalesce((select jsonb_object_agg(fields.key,fields.value)
    from jsonb_each(e.data) fields where fields.key=any(array[
      'description','date','datePrecision','year','category','tags','artist','lyrics','lyricsOffset',
      'assetId','coverAssetId','externalUrl','sourceType','city','venue','attendance','mood','lifeStage',
      'featured','verified','scheduledDate'
    ]::text[])), '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
    'albumId',case when exists(select 1 from public.entries rel where rel.id::text=e.data->>'albumId'
      and rel.owner_id=e.owner_id and rel.kind='albums' and rel.is_public
      and coalesce(rel.data->>'status','saved')<>'draft') then e.data->'albumId' else null end,
    'relatedIds',case when e.data ? 'relatedIds' then coalesce((select jsonb_agg(to_jsonb(ref.value) order by ref.ordinality)
      from jsonb_array_elements_text(e.data->'relatedIds') with ordinality ref(value,ordinality)
      where exists(select 1 from public.entries rel where rel.id::text=ref.value and rel.owner_id=e.owner_id
        and rel.is_public and coalesce(rel.data->>'status','saved')<>'draft')),'[]'::jsonb) else null end,
    'itemIds',case when e.data ? 'itemIds' then coalesce((select jsonb_agg(to_jsonb(ref.value) order by ref.ordinality)
      from jsonb_array_elements_text(e.data->'itemIds') with ordinality ref(value,ordinality)
      where exists(select 1 from public.entries rel where rel.id::text=ref.value and rel.owner_id=e.owner_id
        and rel.is_public and coalesce(rel.data->>'status','saved')<>'draft')),'[]'::jsonb) else null end,
    'chapters',case when e.data ? 'chapters' then coalesce((select jsonb_agg(to_jsonb(ref.value) order by ref.ordinality)
      from jsonb_array_elements_text(e.data->'chapters') with ordinality ref(value,ordinality)
      where exists(select 1 from public.entries rel where rel.id::text=ref.value and rel.owner_id=e.owner_id
        and rel.kind='journey' and rel.is_public and coalesce(rel.data->>'status','saved')<>'draft')),'[]'::jsonb) else null end
  )) as data,
  e.is_public,e.created_at,e.updated_at
from public.entries e
where e.owner_id in (select p.id from public.profiles p)
  and e.is_public and coalesce(e.data->>'status','saved')<>'draft';
alter view public.public_entries owner to archive_visitor_projection;
revoke all on public.public_entries from public,anon,authenticated;
grant select on public.public_entries to anon,authenticated;

-- File basenames supplied by the owner, ownership IDs, full paths and rights
-- evidence remain private. The extension is needed to locate legacy .jpeg/.jpg
-- variants without disclosing the original filename or owner folder.
create view public.public_media_assets with (security_barrier=true,security_invoker=false) as
select a.id,a.mime_type,a.size,a.media_type,
  pg_catalog.substring(a.storage_path,'\.([a-z0-9]+)$') as storage_extension,a.created_at
from public.media_assets a
where a.owner_id in (select p.id from public.profiles p)
  and a.storage_path ~ ('^' || a.owner_id::text || '/' || a.id::text || '\.(jpg|jpeg|png|webp|gif|avif|mp3|wav|ogg|flac|m4a|mp4|webm)$')
  and exists(select 1 from public.entries e where e.owner_id=a.owner_id
    and e.is_public and coalesce(e.data->>'status','saved')<>'draft'
    and a.id::text in (e.data->>'assetId',e.data->>'coverAssetId'));
alter view public.public_media_assets owner to archive_visitor_projection;
revoke all on public.public_media_assets from public,anon,authenticated;
grant select on public.public_media_assets to anon,authenticated;

create view public.public_site_settings with (security_barrier=true,security_invoker=false) as
select coalesce((select jsonb_object_agg(fields.key,fields.value)
    from jsonb_each(s.settings) fields where fields.key=any(array[
      'siteName','subtitle','startYear','animation','theme','timezone','heroPosition','moduleOrder','hiddenModules'
    ]::text[])), '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
    'heroAssetId',case when exists(select 1 from public.media_assets a
      where a.owner_id=s.owner_id and a.id::text=s.settings->>'heroAssetId') then s.settings->'heroAssetId' else null end,
    'mobileHeroAssetId',case when exists(select 1 from public.media_assets a
      where a.owner_id=s.owner_id and a.id::text=s.settings->>'mobileHeroAssetId') then s.settings->'mobileHeroAssetId' else null end,
    'featuredIds',coalesce((select jsonb_agg(to_jsonb(ref.value) order by ref.ordinality)
      from jsonb_array_elements_text(coalesce(s.settings->'featuredIds','[]'::jsonb)) with ordinality ref(value,ordinality)
      where exists(select 1 from public.entries e where e.id::text=ref.value and e.owner_id=s.owner_id
        and e.is_public and coalesce(e.data->>'status','saved')<>'draft')),'[]'::jsonb)
  )) as settings
from public.site_settings s
where s.owner_id in (select p.id from public.profiles p);
alter view public.public_site_settings owner to archive_visitor_projection;
revoke all on public.public_site_settings from public,anon,authenticated;
grant select on public.public_site_settings to anon,authenticated;

-- The only definer helper is a boolean check for an exact existing object. Its
-- constrained role cannot see unselected assets, even if the query changes.
-- Anonymous access is intentional; no ownership UUID/path is returned to REST.
create or replace function archive_public.is_selected_media_object(object_owner text,object_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.media_assets a
    where a.owner_id::text=object_owner and a.storage_path=object_name
      and a.owner_id in (select p.id from public.profiles p)
      and exists(select 1 from public.entries e where e.owner_id=a.owner_id
        and e.is_public and coalesce(e.data->>'status','saved')<>'draft'
        and a.id::text in (e.data->>'assetId',e.data->>'coverAssetId')))
$$;
alter function archive_public.is_selected_media_object(text,text) owner to archive_visitor_projection;
revoke all on function archive_public.is_selected_media_object(text,text) from public,anon,authenticated,service_role;
grant execute on function archive_public.is_selected_media_object(text,text) to anon,authenticated;

-- SELECT alone also authorizes signing/listing in Storage. Restrict the exact
-- operation: raw GET (including Range) and HEAD only. No signed URLs survive a
-- later withdrawal. Empty or unrelated operations, info metadata, listing,
-- image transforms, S3 and all write operations fail closed.
drop policy if exists private_media_selected_public_read on storage.objects;
create policy private_media_selected_public_read on storage.objects for select to anon,authenticated
  using(bucket_id='private-media'
    and (storage.allow_only_operation('object.get_authenticated')
      or storage.allow_only_operation('object.head_authenticated_info'))
    and archive_public.is_selected_media_object(owner_id,name));
update storage.buckets set public=false where id in ('private-media','private-theme');

revoke create on schema public,archive_public from archive_visitor_projection;
notify pgrst,'reload schema';
commit;
