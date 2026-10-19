import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultSettings } from "../../lib/types";

// PostgreSQL runs for real; the surrounding Supabase Auth/Storage schemas are modeled.
// This deliberately does not claim live Supabase service/network verification.
const owner = "a0000000-0000-4000-8000-000000000001";
const other = "b0000000-0000-4000-8000-000000000002";
const quote = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
let db: PGlite;
const settings = quote(defaultSettings);
async function role(id = owner) {
  await db.exec("reset role");
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`);
}
async function restore(entries: unknown[], assets: unknown[] = [], cfg: unknown = defaultSettings) {
  return db.query(`select public.restore_backup(${quote(entries)},${quote(cfg)},${quote(assets)}) result`);
}
function entry(id: string, data: object = {}, kind = "journal") {
  return {id, owner_id: owner, kind, title: "原创数据库测试", data, favorite: false};
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,storage to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb default '{}');
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    grant execute on function storage.foldername(text) to anon,authenticated;
    insert into auth.users values('${owner}'),('${other}');
  `);
  await db.exec(await readFile(path.join(process.cwd(), "supabase/migrations/202610090001_private_memorial.sql"), "utf8"));
  await db.exec(await readFile(path.join(process.cwd(), "supabase/migrations/202610180001_optional_media_metadata.sql"), "utf8"));
  await db.exec(`insert into public.profiles(id) values('${owner}'); insert into public.site_settings(owner_id,settings) values('${owner}',${settings});`);
});
afterEach(async () => {await db.exec("rollback; reset role");});
afterAll(async () => {await db.close();});

describe("PostgreSQL migration: actual RLS, constraints and transaction behavior", () => {
  it("only an operator can enroll the single allowlisted owner", async () => {
    await expect(db.exec(`insert into public.profiles(id) values('${other}')`)).rejects.toThrow(/unique/i);
    await role();
    await expect(db.exec(`update public.profiles set id='${other}'`)).rejects.toThrow(/permission/i);
    const mine = await db.query("select id from public.profiles");
    expect(mine.rows).toEqual([{id: owner}]);
  });

  it("rejects anonymous reads and excludes a second authenticated user", async () => {
    await db.exec("set role anon");
    await expect(db.query("select * from public.entries")).rejects.toThrow(/permission/i);
    await role(other);
    expect((await db.query("select * from public.site_settings")).rows).toHaveLength(0);
    expect((await db.query("select public.is_allowed_owner() allowed")).rows).toEqual([{allowed: false}]);
    await expect(db.exec(`insert into public.entries(owner_id,kind,title) values('${other}','journal','forged')`)).rejects.toThrow(/row-level/i);
    await expect(restore([])).rejects.toThrow(/authorization/i);
  });

  it("protects owner_id, immutable kind and record ID on writes", async () => {
    await role();
    const id = "c0000000-0000-4000-8000-000000000003";
    await restore([entry(id)]);
    await expect(db.exec(`update public.entries set owner_id='${other}' where id='${id}'`)).rejects.toThrow(/immutable|row-level/i);
    await expect(db.exec(`update public.entries set kind='letters' where id='${id}'`)).rejects.toThrow(/immutable/i);
    await expect(db.exec(`update public.entries set id=gen_random_uuid() where id='${id}'`)).rejects.toThrow(/immutable/i);
    await role(other);
    expect((await db.query(`select * from public.entries where id='${id}'`)).rows).toHaveLength(0);
    await db.exec(`update public.entries set title='intrusion' where id='${id}'; delete from public.entries where id='${id}'`);
    await role();
    expect((await db.query(`select title from public.entries where id='${id}'`)).rows).toEqual([{title: "原创数据库测试"}]);
  });

  it("rejects forged owners and rolls back the entire restore after one bad relationship", async () => {
    await role();
    const good = "d0000000-0000-4000-8000-000000000004";
    const bad = "d0000000-0000-4000-8000-000000000005";
    await expect(restore([{...entry(good), owner_id: other}])).rejects.toThrow(/owner mismatch/i);
    await expect(restore([entry(good), entry(bad, {relatedIds: [other]})])).rejects.toThrow(/relationship/i);
    expect((await db.query(`select id from public.entries where id in ('${good}','${bad}')`)).rows).toHaveLength(0);
    await expect(restore([entry(good), entry(good)])).rejects.toThrow(/duplicate/i);
  });

  it("restores parent/child records in one transaction and prevents dangling deletes", async () => {
    await role();
    const album = "e0000000-0000-4000-8000-000000000006";
    const music = "e0000000-0000-4000-8000-000000000007";
    await restore([entry(music, {albumId: album}, "music"), entry(album, {}, "albums")]);
    await expect(db.exec(`delete from public.entries where id='${album}'`)).rejects.toThrow(/referenced/i);
    await db.exec(`update public.entries set data='{}' where id='${music}'; delete from public.entries where id='${album}'`);
    expect((await db.query(`select id from public.entries where id='${album}'`)).rows).toHaveLength(0);
  });

  it("refuses unknown fields and incorrect media relationships", async () => {
    await role();
    await expect(restore([entry("e0000000-0000-4000-8000-000000000008", {isPublished: true})])).rejects.toThrow(/unsupported/i);
    await expect(restore([entry("e0000000-0000-4000-8000-000000000009", {assetId: other}, "photos")])).rejects.toThrow(/media relationship/i);
  });

  it("keeps storage private and validates both object ownership and owner path", async () => {
    await role();
    const file = `${owner}/f0000000-0000-4000-8000-000000000010.png`;
    await db.exec(`insert into storage.objects(bucket_id,name,owner_id) values('private-media','${file}','${owner}')`);
    await expect(db.exec(`insert into storage.objects(bucket_id,name,owner_id) values('private-media','${other}/fake.png','${owner}')`)).rejects.toThrow(/row-level/i);
    await expect(db.exec(`update storage.objects set owner_id='${other}' where name='${file}'`)).rejects.toThrow(/row-level/i);
    await role(other);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(0);
    await db.exec("reset role; set role anon");
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(0);
    await db.exec("reset role");
    expect((await db.query("select public from storage.buckets where id='private-media'")).rows).toEqual([{public: false}]);
  });

  it("refuses missing storage bytes, referenced deletion and in-place file replacement", async () => {
    await role();
    const id="f0000000-0000-4000-8000-000000000011";
    const file=`${owner}/${id}.png`;
    const asset={id,owner_id:owner,filename:"original.png",mime_type:"image/png",size:200,media_type:"image",storage_path:file,
      rights_holder:"原创测试作者",rights_status:"personal_only",license_notes:"原创测试图形",allowed_use_scope:["private_storage"]};
    await expect(restore([], [asset])).rejects.toThrow(/storage file missing/i);
    await db.exec(`insert into storage.objects(bucket_id,name,owner_id,metadata) values('private-media','${file}','${owner}','{"size":200}')`);
    const photo="f0000000-0000-4000-8000-000000000012";
    await restore([entry(photo,{assetId:id},"photos")],[asset]);
    await expect(db.exec(`delete from public.media_assets where id='${id}'`)).rejects.toThrow(/referenced/i);
    expect((await db.query(`update storage.objects set metadata='{"size":300}' where name='${file}' returning id`)).rows).toHaveLength(0);
    expect((await db.query(`delete from storage.objects where name='${file}' returning id`)).rows).toHaveLength(0);
    await expect(db.exec(`update public.media_assets set size=300 where id='${id}'`)).rejects.toThrow(/immutable/i);
    await db.exec(`delete from public.entries where id='${photo}'; delete from public.media_assets where id='${id}'; delete from storage.objects where name='${file}'`);
  });

  it("stores private media without attribution or licence notes while preserving legacy metadata and other constraints", async () => {
    await role();
    const id="f0000000-0000-4000-8000-000000000015";
    const file=`${owner}/${id}.png`;
    const asset={id,owner_id:owner,filename:"synthetic.png",mime_type:"image/png",size:200,media_type:"image",storage_path:file,
      rights_status:"personal_only",allowed_use_scope:["private_storage"]};
    await db.exec(`insert into storage.objects(bucket_id,name,owner_id,metadata) values('private-media','${file}','${owner}','{"size":200}')`);
    await restore([], [asset]);
    expect((await db.query(`select rights_holder,license_notes,rights_status from public.media_assets where id='${id}'`)).rows)
      .toEqual([{rights_holder:null,license_notes:null,rights_status:"personal_only"}]);
    await db.exec(`update public.media_assets set rights_holder='原作者记录',license_notes='原有说明' where id='${id}'`);
    await db.exec(`update public.media_assets set attribution='保留的署名' where id='${id}'`);
    expect((await db.query(`select rights_holder,license_notes from public.media_assets where id='${id}'`)).rows)
      .toEqual([{rights_holder:"原作者记录",license_notes:"原有说明"}]);
    await expect(db.exec(`update public.media_assets set rights_status='made_up' where id='${id}'`)).rejects.toThrow(/check constraint/i);
    await expect(db.exec(`update public.media_assets set allowed_use_scope='["made_up"]' where id='${id}'`)).rejects.toThrow(/check constraint/i);
    await expect(db.exec(`update public.media_assets set rights_holder=repeat('x',1001) where id='${id}'`)).rejects.toThrow(/check constraint/i);
    await role(other);
    expect((await db.query(`select id from public.media_assets where id='${id}'`)).rows).toHaveLength(0);
    await role();
    await db.exec(`delete from public.media_assets where id='${id}'; delete from storage.objects where name='${file}'`);
  });

  it("keeps audio relationships usable without legacy playback scopes and still checks type and references", async () => {
    await role();
    const id="f0000000-0000-4000-8000-000000000016";
    const music="f0000000-0000-4000-8000-000000000017";
    const file=`${owner}/${id}.wav`;
    const asset={id,owner_id:owner,filename:"synthetic.wav",mime_type:"audio/wav",size:200,media_type:"audio",storage_path:file,
      rights_status:"unknown",allowed_use_scope:[]};
    await db.exec(`insert into storage.objects(bucket_id,name,owner_id,metadata) values('private-media','${file}','${owner}','{"size":200}')`);
    await restore([entry(music, {assetId:id}, "music")], [asset]);
    await db.exec(`update public.media_assets set attribution='原有署名',allowed_use_scope='[]' where id='${id}'`);
    expect((await db.query(`select allowed_use_scope,rights_status,rights_holder,license_notes from public.media_assets where id='${id}'`)).rows)
      .toEqual([{allowed_use_scope:[],rights_status:"unknown",rights_holder:null,license_notes:null}]);
    await expect(db.exec(`update public.entries set data=jsonb_build_object('coverAssetId','${id}') where id='${music}'`)).rejects.toThrow(/wrong type/i);
    await expect(db.exec(`delete from public.media_assets where id='${id}'`)).rejects.toThrow(/referenced/i);
    await db.exec(`delete from public.entries where id='${music}'; delete from public.media_assets where id='${id}'; delete from storage.objects where name='${file}'`);
  });

  it("validates real calendar dates and settings even through the direct Data API", async () => {
    await role();
    await expect(restore([entry("f0000000-0000-4000-8000-000000000013",{date:"2025-02-29",datePrecision:"day"})])).rejects.toThrow(/calendar date/i);
    await expect(restore([],[],{...defaultSettings,imageLimitMb:-1})).rejects.toThrow(/settings number|upload setting/i);
    await expect(restore([],[],{...defaultSettings,isPublic:true})).rejects.toThrow(/unsupported settings/i);
    await restore([entry("f0000000-0000-4000-8000-000000000014",{date:"2024-02-29",datePrecision:"day"})]);
  });
});
