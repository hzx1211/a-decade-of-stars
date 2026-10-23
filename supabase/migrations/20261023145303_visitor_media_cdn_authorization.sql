-- Hosted Storage/CDN authorizes object GETs through an internal GET-info call.
-- Permit that one extra step only to the application proxy, with a dedicated
-- token that cannot sign URLs, list objects, write, or read unselected assets.
begin;

create table if not exists archive_public.media_read_access (
  singleton boolean primary key default true check(singleton),
  token_sha256 text not null check(token_sha256 ~ '^[0-9a-f]{64}$')
);
alter table archive_public.media_read_access enable row level security;
alter table archive_public.media_read_access force row level security;
revoke all on archive_public.media_read_access from public,anon,authenticated,service_role,supabase_auth_admin;
revoke all on archive_public.media_read_access from archive_visitor_projection;
grant select on archive_public.media_read_access to archive_visitor_projection;
drop policy if exists visitor_media_access_config on archive_public.media_read_access;
create policy visitor_media_access_config on archive_public.media_read_access for select
  to archive_visitor_projection using(singleton);

-- Configure the one row separately through trusted SQL. Only a SHA-256 digest
-- is stored here; the random token belongs in the server-only deployment env.
-- Never put it in NEXT_PUBLIC variables, client props, redirects or URLs.
grant create on schema archive_public to archive_visitor_projection;
create or replace function archive_public.has_media_read_token()
returns boolean language sql stable security definer set search_path='' as $$
  with supplied as (
    select coalesce(nullif(pg_catalog.current_setting('request.headers',true),'')::jsonb
      ->>'x-archive-public-media-token','') as token
  )
  select exists(select 1 from archive_public.media_read_access cfg,supplied
    where cfg.singleton and pg_catalog.octet_length(supplied.token) between 32 and 256
      and cfg.token_sha256=pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to(supplied.token,'UTF8')),'hex'))
$$;
alter function archive_public.has_media_read_token() owner to archive_visitor_projection;
revoke all on function archive_public.has_media_read_token() from public,anon,authenticated,service_role,supabase_auth_admin;
grant execute on function archive_public.has_media_read_token() to anon,authenticated;
revoke create on schema archive_public from archive_visitor_projection;

drop policy if exists private_media_selected_public_read on storage.objects;
create policy private_media_selected_public_read on storage.objects for select to anon,authenticated
  using(bucket_id='private-media'
    and (
      storage.allow_only_operation('object.get_authenticated')
      or storage.allow_only_operation('object.head_authenticated_info')
      or (
        storage.allow_only_operation('object.get_authenticated_info')
        -- These are request properties set by Storage, not a forwarded URL or
        -- method supplied in a client header. Exclude other metadata routes.
        and pg_catalog.current_setting('request.method',true)='GET'
        and pg_catalog.current_setting('request.path',true)='/object/info/authenticated/private-media/' || name
        and archive_public.has_media_read_token()
      )
    )
    and archive_public.is_selected_media_object(owner_id,name));

notify pgrst,'reload schema';
commit;
