import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Only the PostgreSQL trigger/permissions are real here. Auth HTTP behavior,
// managed-role DDL permission and Admin createUser require separate live checks.
const ownerId = "a0000000-0000-4000-8000-000000000001";
const otherId = "b0000000-0000-4000-8000-000000000002";
const ownerEmail = "synthetic-owner@example.invalid";
const digest = createHash("sha256").update(ownerEmail).digest("hex");
const marker = { archive_owner_provisioned: true };
let db: PGlite;
let migration: string;
let deferredMigration: string;

async function arm() {
  await db.exec("reset role");
  await db.query("insert into archive_private.owner_registration(email_sha256) values($1)", [digest]);
}
async function createUser({id = ownerId, email = ownerEmail, anonymous = false, app = marker, user = {}}: {
  id?: string; email?: string | null; anonymous?: boolean; app?: object | null; user?: object;
} = {}) {
  await db.exec("set role supabase_auth_admin");
  return db.query("insert into auth.users(id,email,is_anonymous,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4::jsonb,$5::jsonb) returning id",
    [id, email, anonymous, JSON.stringify(app), JSON.stringify(user)]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role supabase_auth_admin;
    create schema auth authorization supabase_auth_admin;
    set role supabase_auth_admin;
    create table auth.users(
      id uuid primary key,
      email text,
      is_anonymous boolean default false,
      raw_app_meta_data jsonb default '{}'::jsonb,
      raw_user_meta_data jsonb default '{}'::jsonb,
      check (email is null or email <> 'constraint-failure@example.invalid')
    );
    reset role;
  `);
  migration = await readFile(path.join(process.cwd(), "supabase/migrations/20261023111432_single_owner_auth_registration.sql"), "utf8");
  await db.exec(migration);
  deferredMigration = await readFile(path.join(process.cwd(), "supabase/migrations/20261023112230_defer_owner_registration_validation.sql"), "utf8");
  await db.exec(deferredMigration);
});
afterEach(async () => {
  await db.exec("rollback; reset role; truncate auth.users,archive_private.owner_registration");
});
afterAll(async () => { await db.close(); });

describe("Single-owner Auth registration guard: real PostgreSQL authorization and atomic enrollment", () => {
  it("fails closed until an operator provides the owner email digest", async () => {
    await expect(createUser()).rejects.toThrow(/registration is closed/i);
    await db.exec("reset role");
    expect((await db.query("select id from auth.users")).rows).toHaveLength(0);
    expect((await db.query("select * from archive_private.owner_registration")).rows).toHaveLength(0);
  });

  it("allows only the hash-matched Admin-provisioned owner and consumes the authorization once", async () => {
    await arm();
    expect((await createUser({email: `  ${ownerEmail.toUpperCase()}  `})).rows).toEqual([{id: ownerId}]);
    await db.exec("reset role");
    expect((await db.query("select * from archive_private.owner_registration")).rows).toHaveLength(0);
    await expect(createUser({id: otherId})).rejects.toThrow(/registration is closed/i);
    // Even accidental re-arming cannot create a second user in an occupied Auth project.
    await arm();
    await expect(createUser({id: otherId})).rejects.toThrow(/registration is closed/i);
    await db.exec("reset role");
    expect((await db.query("select id from auth.users")).rows).toEqual([{id: ownerId}]);
  });

  it("supports GoTrue Admin's INSERT followed by app_metadata UPDATE in one transaction", async () => {
    await arm();
    await db.exec("begin");
    // GoTrue adminUserCreate initially inserts provider metadata only.
    await createUser({app: {provider: "email", providers: ["email"]}});
    await db.exec("reset role");
    expect((await db.query("select email_sha256 from archive_private.owner_registration")).rows).toEqual([{email_sha256: digest}]);
    await db.exec("set role supabase_auth_admin");
    await db.query("update auth.users set raw_app_meta_data=raw_app_meta_data || $1::jsonb where id=$2", [JSON.stringify(marker), ownerId]);
    await db.exec("commit; reset role");
    expect((await db.query("select id from auth.users")).rows).toEqual([{id: ownerId}]);
    expect((await db.query("select * from archive_private.owner_registration")).rows).toHaveLength(0);
    expect((await db.query("select tgdeferrable,tginitdeferred from pg_trigger where tgname='archive_single_owner_registration'")).rows)
      .toEqual([{tgdeferrable: true, tginitdeferred: true}]);
  });

  it("rejects public signup at commit when only user metadata spoofs the provisioning flag", async () => {
    await arm();
    await db.exec("begin");
    await createUser({app: {provider: "email", providers: ["email"]}, user: marker});
    await expect(db.exec("commit")).rejects.toThrow(/registration is closed/i);
    await db.exec("rollback; reset role");
    expect((await db.query("select id from auth.users")).rows).toHaveLength(0);
    expect((await db.query("select email_sha256 from archive_private.owner_registration")).rows).toEqual([{email_sha256: digest}]);
  });

  it("rejects other emails, missing email and anonymous creation without consuming the authorization", async () => {
    await arm();
    for (const input of [{email: "other@example.invalid"}, {email: null}, {email: ""}, {email: "  "}, {anonymous: true}]) {
      await expect(createUser(input)).rejects.toThrow(/registration is closed/i);
    }
    await db.exec("reset role");
    expect((await db.query("select email_sha256 from archive_private.owner_registration")).rows).toEqual([{email_sha256: digest}]);
    expect((await createUser()).rows).toEqual([{id: ownerId}]);
  });

  it("rejects public signup even for the owner email and never trusts user-editable metadata", async () => {
    await arm();
    for (const app of [{}, null, {archive_owner_provisioned: false}, {archive_owner_provisioned: "true"}]) {
      await expect(createUser({app, user: marker})).rejects.toThrow(/registration is closed/i);
    }
    await db.exec("reset role");
    expect((await db.query("select email_sha256 from archive_private.owner_registration")).rows).toEqual([{email_sha256: digest}]);
  });

  it("restores the one-time authorization if the Auth insert or its transaction rolls back", async () => {
    const failedEmail = "constraint-failure@example.invalid";
    const failedDigest = createHash("sha256").update(failedEmail).digest("hex");
    await db.query("insert into archive_private.owner_registration(email_sha256) values($1)", [failedDigest]);
    await expect(createUser({email: failedEmail})).rejects.toThrow(/check constraint/i);
    await db.exec("reset role");
    expect((await db.query("select email_sha256 from archive_private.owner_registration")).rows).toEqual([{email_sha256: failedDigest}]);
    await db.query("update archive_private.owner_registration set email_sha256=$1", [digest]);
    await db.exec("begin");
    await createUser();
    await db.exec("rollback; reset role");
    expect((await db.query("select id from auth.users")).rows).toHaveLength(0);
    expect((await db.query("select email_sha256 from archive_private.owner_registration")).rows).toEqual([{email_sha256: digest}]);
    expect((await createUser()).rows).toEqual([{id: ownerId}]);
  });

  it("does not reopen registration when the owner is subsequently deleted", async () => {
    await arm();
    await createUser();
    await db.exec("delete from auth.users");
    await expect(createUser({id: otherId})).rejects.toThrow(/registration is closed/i);
  });

  it("rolls back a multi-user insert together with the consumed one-time authorization", async () => {
    await arm();
    await db.exec("set role supabase_auth_admin");
    await expect(db.query(`insert into auth.users(id,email,raw_app_meta_data) values($1,$3,$4::jsonb),($2,$3,$4::jsonb)`,
      [ownerId, otherId, ownerEmail, JSON.stringify(marker)])).rejects.toThrow(/registration is closed/i);
    await db.exec("reset role");
    expect((await db.query("select id from auth.users")).rows).toHaveLength(0);
    expect((await db.query("select email_sha256 from archive_private.owner_registration")).rows).toEqual([{email_sha256: digest}]);
  });

  it("does not grant clients or the Auth service access to the private configuration or trigger RPC", async () => {
    await arm();
    for (const name of ["anon", "authenticated", "service_role", "supabase_auth_admin"]) {
      await db.exec(`reset role; set role ${name}`);
      await expect(db.query("select email_sha256 from archive_private.owner_registration")).rejects.toThrow(/permission/i);
      await expect(db.query("delete from archive_private.owner_registration")).rejects.toThrow(/permission/i);
      await expect(db.query("select archive_private.guard_single_owner_auth_registration()")).rejects.toThrow(/permission/i);
      if (name !== "supabase_auth_admin") {
        await expect(db.query("select email from auth.users")).rejects.toThrow(/permission/i);
      }
    }
    await db.exec("reset role");
    expect((await db.query("select prosecdef,proconfig from pg_proc where oid='archive_private.guard_single_owner_auth_registration()'::regprocedure")).rows)
      .toEqual([{prosecdef: true, proconfig: ['search_path=""']}]);
    expect((await createUser()).rows).toEqual([{id: ownerId}]);
  });

  it("keeps only a single lowercase hexadecimal digest in the configuration", async () => {
    await arm();
    await expect(db.query("insert into archive_private.owner_registration(email_sha256) values($1)", [digest])).rejects.toThrow(/unique/i);
    await expect(db.query("update archive_private.owner_registration set email_sha256=$1", [ownerEmail])).rejects.toThrow(/check constraint/i);
    await expect(db.exec("update archive_private.owner_registration set singleton=false")).rejects.toThrow(/check constraint/i);
    expect((await db.query("select * from archive_private.owner_registration")).rows).toEqual([{singleton: true, email_sha256: digest}]);
  });

  it("reapplies safely and does not change existing users or block updates", async () => {
    await arm();
    await db.exec(deferredMigration);
    expect((await createUser()).rows).toEqual([{id: ownerId}]);
    await db.exec("reset role");
    await db.exec(deferredMigration);
    await db.exec("set role supabase_auth_admin");
    await db.query("update auth.users set raw_user_meta_data=$1::jsonb where id=$2", [JSON.stringify({syntheticRecoveryUpdate: true}), ownerId]);
    expect((await db.query("select id,raw_user_meta_data from auth.users")).rows)
      .toEqual([{id: ownerId, raw_user_meta_data: {syntheticRecoveryUpdate: true}}]);
    await expect(createUser({id: otherId})).rejects.toThrow(/registration is closed/i);
  });
});
