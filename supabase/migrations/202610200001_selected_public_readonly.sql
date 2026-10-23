-- Selected records may be read anonymously. Existing entries remain private
-- because this column is added with a false default.
alter table public.entries
  add column if not exists is_public boolean not null default false;
create index if not exists entries_public_owner on public.entries(owner_id,created_at desc) where is_public;

-- A narrow view is the only anonymous route to record content. Private notes,
-- licence metadata, owner controls, and links to unselected records are removed.
create or replace view public.public_entries with (security_barrier = true) as
select e.id,e.owner_id,e.kind,e.title,
  (e.data - array['notes','sourceUrl','rightsHolder','rightsStatus','licenseType','licenseNotes','attribution','allowedUseScope',
    'relatedIds','itemIds','chapters','albumId','status','featuredOrder']::text[])
  || jsonb_strip_nulls(jsonb_build_object(
    'albumId',case when exists(select 1 from public.entries rel where rel.id::text=e.data->>'albumId'
      and rel.owner_id=e.owner_id and rel.kind='albums' and rel.is_public and coalesce(rel.data->>'status','saved')<>'draft')
      then e.data->'albumId' else null end,
    'relatedIds',case when e.data ? 'relatedIds' then coalesce((select jsonb_agg(to_jsonb(ref.value))
      from jsonb_array_elements_text(e.data->'relatedIds') as ref(value)
      where exists(select 1 from public.entries rel where rel.id::text=ref.value and rel.owner_id=e.owner_id
        and rel.is_public and coalesce(rel.data->>'status','saved')<>'draft')),'[]'::jsonb) else null end,
    'itemIds',case when e.data ? 'itemIds' then coalesce((select jsonb_agg(to_jsonb(ref.value))
      from jsonb_array_elements_text(e.data->'itemIds') as ref(value)
      where exists(select 1 from public.entries rel where rel.id::text=ref.value and rel.owner_id=e.owner_id
        and rel.is_public and coalesce(rel.data->>'status','saved')<>'draft')),'[]'::jsonb) else null end,
    'chapters',case when e.data ? 'chapters' then coalesce((select jsonb_agg(to_jsonb(ref.value))
      from jsonb_array_elements_text(e.data->'chapters') as ref(value)
      where exists(select 1 from public.entries rel where rel.id::text=ref.value and rel.owner_id=e.owner_id
        and rel.kind='journey' and rel.is_public and coalesce(rel.data->>'status','saved')<>'draft')),'[]'::jsonb) else null end
  )) as data,
  e.is_public,e.created_at,e.updated_at
from public.entries e
where e.owner_id=(select p.id from public.profiles p limit 1)
  and e.is_public and coalesce(e.data->>'status','saved')<>'draft';
revoke all on public.public_entries from public;
grant select on public.public_entries to anon,authenticated;

-- The site's editable settings never become public wholesale. Only display
-- preferences are exposed, and homepage/media IDs are filtered to published rows.
create or replace view public.public_site_settings with (security_barrier = true) as
select s.owner_id,
  (s.settings - array['imageLimitMb','audioLimitMb','videoLimitMb','heroAssetId','mobileHeroAssetId','featuredIds']::text[])
  || jsonb_strip_nulls(jsonb_build_object(
    'heroAssetId',case when exists(select 1 from public.entries e join public.media_assets a on a.owner_id=e.owner_id
        and a.id::text in (e.data->>'assetId',e.data->>'coverAssetId')
      where e.owner_id=s.owner_id and a.id::text=s.settings->>'heroAssetId' and e.is_public
        and coalesce(e.data->>'status','saved')<>'draft') then s.settings->'heroAssetId' else null end,
    'mobileHeroAssetId',case when exists(select 1 from public.entries e join public.media_assets a on a.owner_id=e.owner_id
        and a.id::text in (e.data->>'assetId',e.data->>'coverAssetId')
      where e.owner_id=s.owner_id and a.id::text=s.settings->>'mobileHeroAssetId' and e.is_public
        and coalesce(e.data->>'status','saved')<>'draft') then s.settings->'mobileHeroAssetId' else null end,
    'featuredIds',coalesce((select jsonb_agg(to_jsonb(ref.value))
      from jsonb_array_elements_text(coalesce(s.settings->'featuredIds','[]'::jsonb)) as ref(value)
      where exists(select 1 from public.entries e where e.id::text=ref.value and e.owner_id=s.owner_id
        and e.is_public and coalesce(e.data->>'status','saved')<>'draft')),'[]'::jsonb)
  )) as settings
from public.site_settings s
where s.owner_id=(select p.id from public.profiles p limit 1);
revoke all on public.public_site_settings from public;
grant select on public.public_site_settings to anon,authenticated;

-- Visitors can read only safe metadata for files referenced by a published row.
revoke all on public.media_assets from anon;
grant select (id,owner_id,filename,mime_type,size,media_type,storage_path,created_at) on public.media_assets to anon;
create policy media_public_selected_read on public.media_assets for select to anon
  using(exists(
    select 1 from public.public_entries e where e.owner_id=media_assets.owner_id
      and (e.data->>'assetId'=media_assets.id::text or e.data->>'coverAssetId'=media_assets.id::text)
  ));

-- Keep the Storage bucket private. Signed URLs are issued only after this
-- owner-scoped, selected-record check succeeds.
grant select on storage.objects to anon;
create policy private_media_selected_public_read on storage.objects for select to anon
  using(bucket_id='private-media' and exists(
    select 1 from public.media_assets a where a.owner_id::text=storage.objects.owner_id
      and a.storage_path=storage.objects.name
  ));

-- Preserve the explicit publication choice when an owner restores a metadata backup.
create or replace function public.restore_backup(p_entries jsonb, p_settings jsonb, p_assets jsonb)
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
    count_assets := count_assets+1;
  end loop;
  for item in select value from jsonb_array_elements(p_entries) loop
    if item->>'owner_id' is distinct from caller::text then raise exception 'backup owner mismatch' using errcode='42501'; end if;
    incoming_id := (item->>'id')::uuid;
    insert into public.entries(id,owner_id,kind,title,data,favorite,is_public,created_at,updated_at)
      values(incoming_id,caller,item->>'kind',item->>'title',item->'data',coalesce((item->>'favorite')::boolean,false),
        coalesce((item->>'is_public')::boolean,false),coalesce((item->>'created_at')::timestamptz,now()),coalesce((item->>'updated_at')::timestamptz,now()))
      on conflict(id) do update set kind=excluded.kind,title=excluded.title,data=excluded.data,favorite=excluded.favorite,is_public=excluded.is_public;
    count_entries := count_entries+1;
  end loop;
  insert into public.site_settings(owner_id,settings) values(caller,p_settings)
    on conflict(owner_id) do update set settings=excluded.settings;
  set constraints all immediate;
  return jsonb_build_object('entries',count_entries,'assets',count_assets,'settingsUpdated',true);
end $$;
revoke all on function public.restore_backup(jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.restore_backup(jsonb,jsonb,jsonb) to authenticated;
