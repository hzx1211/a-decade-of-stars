-- Registration is closed unless an operator arms one owner creation with the
-- SHA-256 hex digest of lower(trim(email)). No personal email or secret is
-- shipped in this migration. Configure the row only through trusted SQL.
begin;

create schema if not exists archive_private;
revoke all on schema archive_private from public,anon,authenticated,service_role,supabase_auth_admin;

create table if not exists archive_private.owner_registration (
  singleton boolean primary key default true check (singleton),
  email_sha256 text not null check (email_sha256 ~ '^[0-9a-f]{64}$')
);
-- This unexposed table is readable only by its owner. The trigger uses that
-- owner's permissions; Auth itself receives no access to the private schema.
alter table archive_private.owner_registration enable row level security;
revoke all on archive_private.owner_registration from public,anon,authenticated,service_role,supabase_auth_admin;

create or replace function archive_private.guard_single_owner_auth_registration()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare consumed_digest text;
begin
  if new.email is null or pg_catalog.btrim(new.email)=''
    or coalesce(new.is_anonymous,false)
    -- Admin-only app metadata prevents public signup from reserving the owner's
    -- email during the short enrollment window. User metadata is never trusted.
    or new.raw_app_meta_data->'archive_owner_provisioned' is distinct from 'true'::jsonb
    or exists(select 1 from auth.users) then
    raise exception 'Owner registration is closed' using errcode='42501';
  end if;

  -- DELETE is the one-use concurrency gate: competing creates cannot both
  -- consume the same row. Any subsequent failure of the Auth transaction rolls
  -- this consumption back. Successful creation leaves registration closed even
  -- if an operator later deletes the owner account.
  delete from archive_private.owner_registration
    where singleton and email_sha256=pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(new.email)),'UTF8')),'hex')
    returning email_sha256 into consumed_digest;
  if consumed_digest is null then
    raise exception 'Owner registration is closed' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function archive_private.guard_single_owner_auth_registration()
  from public,anon,authenticated,service_role,supabase_auth_admin;

-- Supabase supports triggers on auth.users; this applies to all creation paths,
-- including anonymous/phone signup. Existing users, sessions, password recovery
-- and updates are unaffected. The existing profiles allowlist still authorizes
-- application reads and writes; this guard does not grant owner access itself.
drop trigger if exists archive_single_owner_registration on auth.users;
create trigger archive_single_owner_registration before insert on auth.users
  for each row execute function archive_private.guard_single_owner_auth_registration();

commit;
