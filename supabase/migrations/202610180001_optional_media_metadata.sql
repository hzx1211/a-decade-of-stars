-- This archive is private and owner-authenticated. Attribution and licence notes
-- remain optional historical metadata; uploading never invents those facts.
-- Keep all ownership, RLS, object identity, type, path and size checks unchanged.
do $$
declare
  proof_constraint record;
begin
  -- The initial migration used an unnamed table CHECK. Find only that combined
  -- proof requirement so its generated name does not matter on existing installs.
  for proof_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.media_assets'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%rights_holder IS NOT NULL%'
      and pg_get_constraintdef(oid) ilike '%license_notes IS NOT NULL%'
      and pg_get_constraintdef(oid) ilike '%private_storage%'
  loop
    execute format('alter table public.media_assets drop constraint %I', proof_constraint.conname);
  end loop;
end;
$$;

-- Playback in this private archive is controlled by owner authentication. An old
-- metadata scope must not prevent an otherwise valid private-media relationship.
drop trigger if exists media_playback_scope on public.media_assets;
drop function if exists public.validate_media_playback_scope();

create or replace function public.validate_entry_relationships() returns trigger
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
        and (expected_type is null or a.media_type=expected_type)) then
        raise exception 'media relationship missing, wrong type, or outside owner' using errcode='23503'; end if;
    end if;
  end loop;
  return null;
end $$;
