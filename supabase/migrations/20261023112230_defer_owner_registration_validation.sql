-- GoTrue Admin creates the user first and updates app_metadata afterwards in
-- the same transaction. Validate the final row at commit, not the INSERT's NEW
-- snapshot, so admin-only provisioning remains compatible with that sequence.
begin;

create or replace function archive_private.guard_single_owner_auth_registration()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  candidate_email text;
  candidate_anonymous boolean;
  candidate_app_metadata jsonb;
  consumed_digest text;
begin
  select email,is_anonymous,raw_app_meta_data
    into candidate_email,candidate_anonymous,candidate_app_metadata
    from auth.users where id=new.id;
  if not found or candidate_email is null or pg_catalog.btrim(candidate_email)=''
    or coalesce(candidate_anonymous,false)
    or candidate_app_metadata->'archive_owner_provisioned' is distinct from 'true'::jsonb
    or exists(select 1 from auth.users where id<>new.id) then
    raise exception 'Owner registration is closed' using errcode='42501';
  end if;

  -- The one-use DELETE still serializes competing enrollment transactions.
  -- Failure at any point, including COMMIT, rolls its consumption back.
  delete from archive_private.owner_registration
    where singleton and email_sha256=pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(candidate_email)),'UTF8')),'hex')
    returning email_sha256 into consumed_digest;
  if consumed_digest is null then
    raise exception 'Owner registration is closed' using errcode='42501';
  end if;
  return null;
end $$;
revoke all on function archive_private.guard_single_owner_auth_registration()
  from public,anon,authenticated,service_role,supabase_auth_admin;

drop trigger if exists archive_single_owner_registration on auth.users;
create constraint trigger archive_single_owner_registration after insert on auth.users
  deferrable initially deferred for each row
  execute function archive_private.guard_single_owner_auth_registration();

commit;
