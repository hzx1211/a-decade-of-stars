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
let releaseMigration: string;
const legacyEntry = "a0000000-0000-4000-8000-000000000099";
const settings = quote(defaultSettings);
async function role(id = owner) {
  await db.exec("reset role");
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false)`);
}
async function restore(entries: unknown[], assets: unknown[] = [], cfg: unknown = defaultSettings) {
  return db.query(`select public.restore_backup(${quote(entries)},${quote(cfg)},${quote(assets)}) result`);
}
function entry(id: string, data: object = {}, kind = "journal") {
  return {id, owner_id: owner, kind, title: "原创数据库测试", data, favorite: false, is_public: false};
}
function uploadIntent(id: string, patch: Record<string, unknown> = {}) {
  return {id, owner_id: owner, filename: "synthetic.png", mime_type: "image/png", size: 200, media_type: "image",
    storage_path: `${owner}/${id}.png`, metadata: {rightsStatus: "personal_only", allowedUseScope: ["private_storage"]},
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), ...patch};
}
async function insertIntent(value: ReturnType<typeof uploadIntent>) {
  return db.query(`insert into public.media_upload_intents(id,owner_id,filename,mime_type,size,media_type,storage_path,metadata,expires_at)
    values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) returning id`,
  [value.id, value.owner_id, value.filename, value.mime_type, value.size, value.media_type, value.storage_path,
    JSON.stringify(value.metadata), value.expires_at]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create role service_role; create role supabase_auth_admin;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,is_anonymous boolean default false,raw_app_meta_data jsonb default '{}');
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
    -- These identities predate the registration guard and model already-issued
    -- JWTs. They are deliberately retained so application RLS still has to
    -- reject the non-owner; the guard only controls subsequent INSERTs.
    insert into auth.users(id) values('${owner}'),('${other}');
  `);
  await db.exec(await readFile(path.join(process.cwd(), "supabase/migrations/202610090001_private_memorial.sql"), "utf8"));
  await db.exec(await readFile(path.join(process.cwd(), "supabase/migrations/202610180001_optional_media_metadata.sql"), "utf8"));
  await db.exec(await readFile(path.join(process.cwd(), "supabase/migrations/202610200001_selected_public_readonly.sql"), "utf8"));
  await db.exec(`insert into public.profiles(id) values('${owner}'); insert into public.site_settings(owner_id,settings) values('${owner}',${settings});`);
  await role();
  await restore([{...entry(legacyEntry, {notes: "迁移前的私人中文记录"}), is_public: true}]);
  await db.exec("reset role");
  releaseMigration = await readFile(path.join(process.cwd(), "supabase/migrations/20261023110248_private_cloud_release.sql"), "utf8");
  await db.exec(releaseMigration);
  await db.exec(await readFile(path.join(process.cwd(), "supabase/migrations/20261023111432_single_owner_auth_registration.sql"), "utf8"));
  await db.exec(await readFile(path.join(process.cwd(), "supabase/migrations/20261023112230_defer_owner_registration_validation.sql"), "utf8"));
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

  it("keeps compatibility views owner-scoped even when old publication flags are true", async () => {
    await role();
    const visible="e0000000-0000-4000-8000-000000000101";
    const hidden="e0000000-0000-4000-8000-000000000102";
    await db.exec(`insert into public.entries(id,owner_id,kind,title,data,is_public) values
      ('${hidden}','${owner}','journal','私密记录','{"description":"PRIVATE-MARKER"}',false),
      ('${visible}','${owner}','journal','已选精选','{"description":"公开内容","notes":"PRIVATE-NOTE","sourceUrl":"https://private.example","relatedIds":["${hidden}"]}',true)`);
    const rows = await db.query("select id,title,is_public,data from public.public_entries");
    expect(rows.rows).toContainEqual(expect.objectContaining({id: visible, title: "已选精选", is_public: true, data: expect.objectContaining({description: "公开内容", relatedIds: []})}));
    expect(JSON.stringify(rows.rows)).not.toContain("PRIVATE-MARKER");
    expect(JSON.stringify(rows.rows)).not.toContain("PRIVATE-NOTE");
    await db.exec("reset role; set role anon");
    await expect(db.query("select id from public.public_entries")).rejects.toThrow(/permission/i);
    await expect(db.query("select settings from public.public_site_settings")).rejects.toThrow(/permission/i);
    await expect(db.query("select * from public.entries")).rejects.toThrow(/permission/i);
    await role(other);
    expect((await db.query("select id from public.public_entries")).rows).toHaveLength(0);
    expect((await db.query("select settings from public.public_site_settings")).rows).toHaveLength(0);
    await role();
    expect((await db.query(`select is_public,data->>'notes' as notes from public.entries where id='${legacyEntry}'`)).rows)
      .toEqual([{is_public: true, notes: "迁移前的私人中文记录"}]);
  });

  it("revokes old column grants and denies anonymous and non-owner access to formerly selected media", async () => {
    await role();
    const publicEntry = "e0000000-0000-4000-8000-000000000201";
    const privateEntry = "e0000000-0000-4000-8000-000000000202";
    const publicAsset = "f0000000-0000-4000-8000-000000000201";
    const privateAsset = "f0000000-0000-4000-8000-000000000202";
    const publicPath = `${owner}/${publicAsset}.png`;
    const privatePath = `${owner}/${privateAsset}.png`;
    await db.exec(`insert into storage.objects(bucket_id,name,owner_id,metadata) values
      ('private-media','${publicPath}','${owner}','{"size":1}'),
      ('private-media','${privatePath}','${owner}','{"size":1}')`);
    const assets = [publicAsset, privateAsset].map(id => ({id, owner_id: owner, filename: `${id}.png`, mime_type: "image/png", size: 1, media_type: "image", storage_path: `${owner}/${id}.png`, rights_status: "personal_only", allowed_use_scope: ["private_storage"]}));
    await restore([
      {...entry(publicEntry, {assetId: publicAsset}, "photos"), is_public: true},
      {...entry(privateEntry, {assetId: privateAsset}, "photos"), is_public: false},
    ], assets);
    await db.exec("reset role; set role anon");
    await expect(db.query("select id,storage_path from public.media_assets")).rejects.toThrow(/permission/i);
    expect((await db.query(`select name from storage.objects where name in ('${publicPath}','${privatePath}')`)).rows).toHaveLength(0);
    await role(other);
    expect((await db.query("select id,storage_path from public.media_assets")).rows).toHaveLength(0);
    expect((await db.query("select name from storage.objects")).rows).toHaveLength(0);
    await role();
    expect((await db.query(`select name from storage.objects where name in ('${publicPath}','${privatePath}')`)).rows)
      .toEqual(expect.arrayContaining([{name: publicPath}, {name: privatePath}]));
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
    expect((await db.query(`update storage.objects set owner_id='${other}' where name='${file}' returning id`)).rows).toHaveLength(0);
    await role(other);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(0);
    await db.exec("reset role; set role anon");
    expect((await db.query(`select * from storage.objects where name='${file}'`)).rows).toHaveLength(0);
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

  it("restores and updates private lyrics including both signed offset boundaries", async () => {
    await role();
    const id = "f0000000-0000-4000-8000-000000000301";
    // Synthetic test text, not a reproduction of an artist's song lyrics.
    const lyrics = "[00:01.00]原创测试第一行\n[00:02.00]原创测试第二行";
    await restore([entry(id, {lyrics, lyricsOffset: -600000}, "music")]);
    expect((await db.query(`select data from public.entries where id='${id}'`)).rows)
      .toEqual([{data: {lyrics, lyricsOffset: -600000}}]);
    await db.exec(`update public.entries set data=data || '{"lyricsOffset":600000}'::jsonb where id='${id}'`);
    expect((await db.query(`select data->>'lyricsOffset' as offset from public.entries where id='${id}'`)).rows)
      .toEqual([{offset: "600000"}]);
    for (const offset of [-600001, 600001, -0.5, "0", null, true, 1e30]) {
      await expect(db.exec(`update public.entries set data=data || ${quote({lyricsOffset: offset})} where id='${id}'`))
        .rejects.toThrow(/lyricsOffset/i);
    }
    await expect(db.exec(`update public.entries set data='{"lyrics":42}' where id='${id}'`)).rejects.toThrow(/lyrics.*string/i);
    await expect(db.exec(`update public.entries set data=jsonb_build_object('lyrics',repeat('x',100001)) where id='${id}'`))
      .rejects.toThrow(/lyrics.*length/i);
    await expect(restore([entry("f0000000-0000-4000-8000-000000000302"), entry("f0000000-0000-4000-8000-000000000303", {lyricsOffset: 600001})]))
      .rejects.toThrow(/lyricsOffset/i);
    expect((await db.query("select id from public.entries where id in ('f0000000-0000-4000-8000-000000000302','f0000000-0000-4000-8000-000000000303')")).rows)
      .toHaveLength(0);
  });

  it("keeps upload expectations immutable and inaccessible to anonymous and non-owner users", async () => {
    await role();
    const id = "f0000000-0000-4000-8000-000000000401";
    const value = uploadIntent(id, {metadata: {rightsHolder: "保留的历史作者", licenseNotes: "保留的历史说明", rightsStatus: "unknown", allowedUseScope: []}});
    await insertIntent(value);
    expect((await db.query(`select filename,storage_path,metadata from public.media_upload_intents where id='${id}'`)).rows)
      .toEqual([{filename: value.filename, storage_path: value.storage_path, metadata: value.metadata}]);
    await expect(db.exec(`update public.media_upload_intents set size=1 where id='${id}'`)).rejects.toThrow(/permission/i);
    await role(other);
    expect((await db.query("select * from public.media_upload_intents")).rows).toHaveLength(0);
    expect((await db.query(`delete from public.media_upload_intents where id='${id}' returning id`)).rows).toHaveLength(0);
    await expect(insertIntent(uploadIntent("f0000000-0000-4000-8000-000000000402", {owner_id: other, storage_path: `${other}/f0000000-0000-4000-8000-000000000402.png`})))
      .rejects.toThrow(/row-level/i);
    await db.exec("reset role; set role anon");
    await expect(db.query("select id from public.media_upload_intents")).rejects.toThrow(/permission/i);
    await expect(insertIntent(uploadIntent("f0000000-0000-4000-8000-000000000402"))).rejects.toThrow(/permission/i);
    await role();
    expect((await db.query(`delete from public.media_upload_intents where id='${id}' returning id`)).rows).toEqual([{id}]);
  });

  it("rejects forged upload paths, invalid media metadata, sizes and expiry windows", async () => {
    await role();
    const id = "f0000000-0000-4000-8000-000000000403";
    const patches: Record<string, unknown>[] = [
      {owner_id: other}, {storage_path: `${other}/${id}.png`}, {storage_path: `${owner}/${other}.png`},
      {filename: "../secret.png"}, {mime_type: "text/html"}, {media_type: "video"}, {size: 0}, {size: 104857601},
      {metadata: {allowedUseScope: ["made_up"]}}, {metadata: {rightsStatus: "made_up"}},
      {metadata: {service_role: "must never be stored"}}, {metadata: {rightsHolder: false}},
      {expires_at: new Date(Date.now() - 60000).toISOString()},
      {expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()},
    ];
    for (const patch of patches) await expect(insertIntent(uploadIntent(id, patch))).rejects.toThrow(/row-level|check constraint|upload/i);
    await insertIntent(uploadIntent(id));
    await expect(insertIntent(uploadIntent(id))).rejects.toThrow(/unique/i);
    await db.exec("reset role");
    await db.exec(`update public.media_upload_intents set created_at=now()-interval '3 hours',expires_at=now()-interval '1 hour' where id='${id}'`);
    await role();
    expect((await db.query(`select id from public.media_upload_intents where id='${id}'`)).rows).toEqual([{id}]);
    expect((await db.query(`delete from public.media_upload_intents where id='${id}' returning id`)).rows).toEqual([{id}]);
  });

  it("allows only known owner-private theme paths and keeps them out of collection records", async () => {
    await role();
    const names = ["theme-media/stage.jpg", "theme-media/beidou.jpg", "theme-media/v-reference.png", "starsea-v2/manifest.json", "starsea-v2/frame-01.webp"];
    for (const name of names) {
      await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('private-theme',$1,$2,'{\"size\":12}')", [`${owner}/${name}`, owner]);
    }
    for (const name of ["theme-media/original-stage.png", "theme-media/stage.jpeg", "starsea-v2/../stage.jpg", "starsea-v2/.env", "starsea-v2/script.svg", "starsea-v2/nested/frame.png"]) {
      await expect(db.query("insert into storage.objects(bucket_id,name,owner_id) values('private-theme',$1,$2)", [`${owner}/${name}`, owner]))
        .rejects.toThrow(/row-level/i);
    }
    await expect(db.query("insert into storage.objects(bucket_id,name,owner_id) values('private-theme',$1,$2)", [`${other}/theme-media/stage.jpg`, owner]))
      .rejects.toThrow(/row-level/i);
    await expect(db.query("insert into storage.objects(bucket_id,name,owner_id) values('private-theme',$1,$2)", [`${owner}/theme-media/stage.jpg`, other]))
      .rejects.toThrow(/row-level/i);
    expect((await db.query("update storage.objects set metadata='{\"size\":1}' where bucket_id='private-theme' returning id")).rows).toHaveLength(0);
    expect((await db.query("select name from storage.objects where bucket_id='private-theme'")).rows).toHaveLength(names.length);
    expect((await db.query("select id from public.media_assets where storage_path like '%theme-media/%'")).rows).toHaveLength(0);
    await role(other);
    expect((await db.query("select name from storage.objects where bucket_id='private-theme'")).rows).toHaveLength(0);
    expect((await db.query("delete from storage.objects where bucket_id='private-theme' returning id")).rows).toHaveLength(0);
    await expect(db.query("insert into storage.objects(bucket_id,name,owner_id) values('private-theme',$1,$2)", [`${other}/theme-media/stage.jpg`, other]))
      .rejects.toThrow(/row-level/i);
    await db.exec("reset role; set role anon");
    expect((await db.query("select name from storage.objects where bucket_id='private-theme'")).rows).toHaveLength(0);
    await db.exec("reset role");
    expect((await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='private-theme'")).rows)
      .toEqual([{public: false, file_size_limit: 12582912, allowed_mime_types: ["image/jpeg", "image/png", "image/webp", "application/json"]}]);
    await role();
    expect((await db.query("delete from storage.objects where bucket_id='private-theme' returning name")).rows).toHaveLength(names.length);
  });

  it("requires a completed owner-owned object before metadata registration and never replaces uploaded bytes", async () => {
    await role();
    const id = "f0000000-0000-4000-8000-000000000404";
    const file = `${owner}/${id}.png`;
    await insertIntent(uploadIntent(id));
    const asset = {id, owner_id: owner, filename: "synthetic.png", mime_type: "image/png", size: 200, media_type: "image", storage_path: file, rights_status: "personal_only", allowed_use_scope: ["private_storage"]};
    await db.exec(`insert into storage.objects(bucket_id,name,owner_id,metadata) values('private-media','${file}','${owner}','{"size":100}')`);
    await expect(restore([], [asset])).rejects.toThrow(/storage file missing|size does not match/i);
    expect((await db.query(`update storage.objects set metadata='{"size":200}' where name='${file}' returning id`)).rows).toHaveLength(0);
    // Model the privileged Storage service finalizing a completed upload. Real
    // HTTP finalization, ownership and bytes still need live integration checks.
    await db.exec("reset role");
    await db.exec(`update storage.objects set metadata='{"size":200}' where name='${file}'`);
    await role();
    await restore([], [asset]);
    expect((await db.query(`select id from public.media_assets where id='${id}'`)).rows).toEqual([{id}]);
    await db.exec(`delete from public.media_upload_intents where id='${id}'`);
    expect((await db.query(`delete from storage.objects where name='${file}' returning id`)).rows).toHaveLength(0);
    await db.exec(`delete from public.media_assets where id='${id}'; delete from storage.objects where name='${file}'`);
  });

  it("reapplies the release migration without changing historical records or pending uploads", async () => {
    await role();
    const id = "f0000000-0000-4000-8000-000000000405";
    await insertIntent(uploadIntent(id));
    await db.exec("reset role");
    await db.exec(releaseMigration);
    await role();
    expect((await db.query(`select is_public,data->>'notes' as notes from public.entries where id='${legacyEntry}'`)).rows)
      .toEqual([{is_public: true, notes: "迁移前的私人中文记录"}]);
    expect((await db.query(`select id from public.media_upload_intents where id='${id}'`)).rows).toEqual([{id}]);
    await db.exec(`delete from public.media_upload_intents where id='${id}'`);
    await role(other);
    expect((await db.query("select id from public.public_entries")).rows).toHaveLength(0);
    await db.exec("reset role; set role anon");
    await expect(db.query("select id from public.media_assets")).rejects.toThrow(/permission/i);
    expect((await db.query("select name from storage.objects")).rows).toHaveLength(0);
  });
});
