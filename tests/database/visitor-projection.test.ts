import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultSettings } from "../../lib/types";

// Real PostgreSQL validates views, column privileges and RLS. The Auth/Storage
// schemas and documented operation helper are modeled, not live services.
const owner = "a0000000-0000-4000-8000-000000000001";
const other = "b0000000-0000-4000-8000-000000000002";
const id = (suffix: number) => `c0000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const rows = {photo: id(1), private: id(2), draft: id(3), album: id(4), privateAlbum: id(5), music: id(6), journey: id(7), privateJourney: id(8), book: id(9)};
const media = {photo: id(101), cover: id(102), private: id(103), draft: id(104), orphan: id(105), music: id(106)};
const storagePath = (asset: string) => `${owner}/${asset}.${asset === media.cover ? "jpeg" : asset === media.music ? "mp3" : "png"}`;
const quote = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
let db: PGlite;
let migration: string;
let cdnMigration: string;

async function asRole(role: "anon" | "authenticated", user = "") {
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claim.sub','${user}',false);
    select set_config('storage.operation','',false),set_config('request.headers','{}',false),
      set_config('request.method','',false),set_config('request.path','',false)`);
}
async function operation(value: string) {
  await db.query("select set_config('storage.operation',$1,false)", [value]);
}
async function denied(query: string, error = /permission/i) {
  await db.exec("savepoint denied_query");
  try {
    await expect(db.exec(query)).rejects.toThrow(error);
  } finally {
    await db.exec("rollback to savepoint denied_query; release savepoint denied_query");
  }
}
function entry(key: string, kind = "journal", data = {}, isPublic = false) {
  return {id: key, owner_id: owner, kind, title: `原创测试 ${key.slice(-3)}`, data, favorite: true, is_public: isPublic};
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
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
    create function storage.allow_only_operation(text) returns boolean language sql stable as $$
      select coalesce(nullif(regexp_replace(current_setting('storage.operation',true),'^storage\\.',''),'')
        = nullif(regexp_replace($1,'^storage\\.',''),''),false)
    $$;
    grant execute on function storage.foldername(text),storage.allow_only_operation(text) to anon,authenticated;
    insert into auth.users(id) values('${owner}'),('${other}');
  `);
  const previous = [
    "202610090001_private_memorial.sql", "202610180001_optional_media_metadata.sql",
    "202610200001_selected_public_readonly.sql", "20261023110248_private_cloud_release.sql",
    "20261023111432_single_owner_auth_registration.sql", "20261023112230_defer_owner_registration_validation.sql",
  ];
  for (const filename of previous) {
    await db.exec(await readFile(path.join(process.cwd(), "supabase/migrations", filename), "utf8"));
  }
  await db.exec(`insert into public.profiles(id) values('${owner}')`);
  await asRole("authenticated", owner);
  const assets = Object.values(media).map(assetId => ({id: assetId, owner_id: owner,
    filename: "PRIVATE-ORIGINAL-FILENAME.png", mime_type: assetId === media.cover ? "image/jpeg" : assetId === media.music ? "audio/mpeg" : "image/png",
    size: 200, media_type: assetId === media.music ? "audio" : "image", storage_path: storagePath(assetId),
    rights_status: "unknown", rights_holder: "PRIVATE-RIGHTS-HOLDER", source_url: "https://private.example/evidence",
    license_notes: "PRIVATE-LICENSE-PROOF", allowed_use_scope: []}));
  for (const asset of assets) {
    await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('private-media',$1,$2,$3::jsonb)",
      [asset.storage_path, owner, JSON.stringify({size: asset.size, privateProof: "PRIVATE-STORAGE-METADATA"})]);
  }
  await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('private-theme',$1,$2,'{\"size\":200}')", [`${owner}/theme-media/stage.jpg`, owner]);
  const entries = [
    entry(rows.photo, "photos", {assetId: media.photo, coverAssetId: media.cover, description: "公开说明", notes: "PRIVATE-NOTE",
      sourceUrl: "https://private.example/proof", rightsHolder: "PRIVATE-HOLDER", rightsStatus: "personal_only", licenseType: "PRIVATE-LICENSE",
      licenseNotes: "PRIVATE-PROOF", attribution: "PRIVATE-ATTRIBUTION", allowedUseScope: ["private_storage"], featuredOrder: 991,
      relatedIds: [rows.private, rows.album, rows.draft]}, true),
    entry(rows.private, "photos", {assetId: media.private, description: "PRIVATE-RECORD"}),
    entry(rows.draft, "photos", {assetId: media.draft, status: "draft", description: "PRIVATE-DRAFT"}, true),
    entry(rows.album, "albums", {itemIds: [rows.music, rows.private]}, true),
    entry(rows.privateAlbum, "albums", {description: "PRIVATE-ALBUM"}),
    entry(rows.music, "music", {assetId: media.music, albumId: rows.privateAlbum, lyrics: "原创测试歌词", lyricsOffset: -500}, true),
    entry(rows.journey, "journey", {description: "公开旅程"}, true),
    entry(rows.privateJourney, "journey", {description: "PRIVATE-JOURNEY"}),
    entry(rows.book, "memory-book", {chapters: [rows.journey, rows.privateJourney]}, true),
  ];
  const cfg = {...defaultSettings, heroAssetId: media.private, mobileHeroAssetId: media.cover,
    featuredIds: [rows.private, rows.photo, rows.draft, rows.album]};
  await db.query(`select public.restore_backup(${quote(entries)},${quote(cfg)},${quote(assets)})`);
  await db.exec("reset role");
  migration = await readFile(path.join(process.cwd(), "supabase/migrations/20261023143940_selected_visitor_projection.sql"), "utf8");
  await db.exec(migration);
  cdnMigration = await readFile(path.join(process.cwd(), "supabase/migrations/20261023145303_visitor_media_cdn_authorization.sql"), "utf8");
  await db.exec(cdnMigration);
});
beforeEach(async () => {await db.exec("begin");});
afterEach(async () => {await db.exec("rollback; reset role");});
afterAll(async () => {await db.close();});

describe("PostgreSQL selected visitor projection", () => {
  it("exposes only selected non-draft rows with a strict public data allowlist", async () => {
    await asRole("anon");
    const result = (await db.query<{id: string; data: Record<string, unknown>}>("select * from public.public_entries order by id")).rows;
    expect(result.map(row => row.id)).toEqual([rows.photo, rows.album, rows.music, rows.journey, rows.book]);
    expect(result.find(row => row.id === rows.photo)).toMatchObject({is_public: true,
      data: {description: "公开说明", assetId: media.photo, coverAssetId: media.cover, relatedIds: [rows.album]}});
    const output = JSON.stringify(result);
    expect(output).not.toContain("PRIVATE-");
    for (const field of ["owner_id", "favorite", "notes", "sourceUrl", "rightsHolder", "rightsStatus", "licenseType", "licenseNotes", "attribution", "allowedUseScope", "featuredOrder", "status"]) {
      expect(output).not.toContain(`"${field}"`);
    }
    await denied("select owner_id from public.public_entries", /does not exist/i);
  });

  it("removes private associations and preserves visible association order", async () => {
    await asRole("anon");
    const result = (await db.query<{id: string; data: Record<string, unknown>}>("select id,data from public.public_entries")).rows;
    expect(result.find(row => row.id === rows.photo)?.data.relatedIds).toEqual([rows.album]);
    expect(result.find(row => row.id === rows.album)?.data.itemIds).toEqual([rows.music]);
    expect(result.find(row => row.id === rows.book)?.data.chapters).toEqual([rows.journey]);
    expect(result.find(row => row.id === rows.music)?.data).toEqual({assetId: media.music, lyrics: "原创测试歌词", lyricsOffset: -500});
  });

  it("exposes only directly referenced safe media metadata, including legacy suffixes", async () => {
    await asRole("anon");
    const result = (await db.query<{id: string; mime_type: string; storage_extension: string}>("select * from public.public_media_assets order by id")).rows;
    expect(result.map(row => row.id)).toEqual([media.photo, media.cover, media.music]);
    expect(result.find(row => row.id === media.cover)).toMatchObject({mime_type: "image/jpeg", storage_extension: "jpeg"});
    const output = JSON.stringify(result);
    for (const value of [owner, "PRIVATE-", "filename", "storage_path", "owner_id", "rights_status", "license_notes", "allowed_use_scope", "source_url"]) {
      expect(output).not.toContain(value);
    }
    for (const field of ["id", "storage_path", "filename", "rights_status"]) {
      await denied(`select ${field} from public.media_assets`);
    }
  });

  it("filters hero/featured settings and excludes private upload controls", async () => {
    await asRole("anon");
    const result = (await db.query<{settings: Record<string, unknown>}>("select * from public.public_site_settings")).rows;
    expect(result).toHaveLength(1);
    expect(result[0].settings).toMatchObject({siteName: defaultSettings.siteName, mobileHeroAssetId: media.cover, featuredIds: [rows.photo, rows.album]});
    for (const field of ["owner_id", "heroAssetId", "imageLimitMb", "audioLimitMb", "videoLimitMb"]) {
      expect(JSON.stringify(result)).not.toContain(`"${field}"`);
    }
    await denied("select settings from public.site_settings");
    await denied("select id from public.profiles");
  });

  it("allows exact GET and HEAD operations while forbidding signing, listing and info", async () => {
    await asRole("anon");
    for (const op of ["object.get_authenticated", "storage.object.get_authenticated", "object.head_authenticated_info"]) {
      await operation(op);
      const result = (await db.query<{name: string}>("select name from storage.objects order by name")).rows;
      expect(result.map(row => row.name)).toEqual([media.photo, media.cover, media.music].map(storagePath).sort());
    }
    for (const op of ["", "object", "object.get_authenticated_info", "object.list", "storage.object.list_v2", "object.sign", "object.sign_many", "object.sign_upload_url", "storage.render.image_sign", "storage.s3.object.get", "object.get_public", "object.get_signed"]) {
      await operation(op);
      expect((await db.query("select name from storage.objects")).rows).toHaveLength(0);
    }
  });

  it("denies the theme bucket, private/draft/unreferenced objects and forged owner/path combinations", async () => {
    await asRole("anon");
    await operation("object.get_authenticated");
    expect((await db.query("select name from storage.objects where bucket_id='private-theme'")).rows).toHaveLength(0);
    for (const assetId of [media.private, media.draft, media.orphan]) {
      expect((await db.query("select name from storage.objects where name=$1", [storagePath(assetId)])).rows).toHaveLength(0);
    }
    const combinations = [[owner, storagePath(media.photo), true], [other, storagePath(media.photo), false],
      [owner, `${other}/${media.photo}.png`, false], [owner, `${owner}/${media.photo}.jpeg`, false],
      [owner, `${owner}/theme-media/stage.jpg`, false], [owner, `${owner}/../${media.photo}.png`, false]];
    for (const [objectOwner, objectName, visible] of combinations) {
      expect((await db.query("select archive_public.is_selected_media_object($1,$2) visible", [objectOwner, objectName])).rows)
        .toEqual([{visible}]);
    }
    await db.exec("reset role");
    expect((await db.query("select id,public from storage.buckets order by id")).rows)
      .toEqual([{id: "private-media", public: false}, {id: "private-theme", public: false}]);
  });

  it("withdraws entries, references, settings and bytes on the next read", async () => {
    await asRole("authenticated", owner);
    await db.query("update public.entries set is_public=false where id=$1", [rows.photo]);
    await asRole("anon");
    await operation("object.get_authenticated");
    expect((await db.query("select id from public.public_entries where id=$1", [rows.photo])).rows).toHaveLength(0);
    expect((await db.query("select id from public.public_media_assets where id in ($1,$2)", [media.photo, media.cover])).rows).toHaveLength(0);
    expect((await db.query("select name from storage.objects where name in ($1,$2)", [storagePath(media.photo), storagePath(media.cover)])).rows).toHaveLength(0);
    const cfg = (await db.query<{settings: Record<string, unknown>}>("select settings from public.public_site_settings")).rows[0].settings;
    expect(cfg.featuredIds).toEqual([rows.album]);
    expect(cfg).not.toHaveProperty("mobileHeroAssetId");
    await asRole("authenticated", owner);
    await db.query("update public.entries set data=data || '{\"status\":\"draft\"}'::jsonb where id=$1", [rows.music]);
    await asRole("anon");
    await operation("object.get_authenticated");
    expect((await db.query("select id from public.public_media_assets where id=$1", [media.music])).rows).toHaveLength(0);
    expect((await db.query("select name from storage.objects where name=$1", [storagePath(media.music)])).rows).toHaveLength(0);
    const album = (await db.query<{data: {itemIds: string[]}}>("select data from public.public_entries where id=$1", [rows.album])).rows[0];
    expect(album.data.itemIds).toEqual([]);
  });

  it("keeps a shared asset readable only until its final selected reference is withdrawn", async () => {
    await asRole("authenticated", owner);
    await db.query("update public.entries set data=data || jsonb_build_object('coverAssetId',$1::text) where id=$2", [media.cover, rows.book]);
    await db.query("update public.entries set is_public=false where id=$1", [rows.photo]);
    await asRole("anon");
    await operation("object.get_authenticated");
    expect((await db.query("select id from public.public_media_assets where id=$1", [media.cover])).rows).toEqual([{id: media.cover}]);
    expect((await db.query("select name from storage.objects where name=$1", [storagePath(media.cover)])).rows).toEqual([{name: storagePath(media.cover)}]);
    await asRole("authenticated", owner);
    await db.query("update public.entries set is_public=false where id=$1", [rows.book]);
    await asRole("anon");
    await operation("object.get_authenticated");
    expect((await db.query("select id from public.public_media_assets where id=$1", [media.cover])).rows).toHaveLength(0);
    expect((await db.query("select name from storage.objects where name=$1", [storagePath(media.cover)])).rows).toHaveLength(0);
  });

  it("preserves owner reads, writes and backups while anonymous and non-owner writes fail", async () => {
    await asRole("anon");
    for (const query of ["select * from public.entries", "update public.entries set is_public=true", "delete from public.entries",
      "update public.public_entries set title='forged'", "delete from public.public_media_assets", "select public.restore_backup('[]','{}','[]')"]) {
      await denied(query, /permission|not automatically updatable/i);
    }
    await asRole("authenticated", other);
    expect((await db.query("select * from public.entries")).rows).toHaveLength(0);
    expect((await db.query("select id from public.public_entries")).rows).toHaveLength(5);
    await denied(`insert into public.entries(owner_id,kind,title) values('${other}','journal','forged')`, /row-level/i);
    await denied("select public.restore_backup('[]','{}','[]')", /authorization/i);
    await asRole("authenticated", owner);
    expect((await db.query("select id from public.entries")).rows).toHaveLength(9);
    expect((await db.query("select filename,license_notes from public.media_assets")).rows).toHaveLength(6);
    expect((await db.query("select name from storage.objects")).rows).toHaveLength(7);
    expect((await db.query<{data: {notes: string}}>("select data from public.entries where id=$1", [rows.photo])).rows[0].data.notes).toEqual("PRIVATE-NOTE");
    await db.query("update public.entries set title='owner edited' where id=$1", [rows.photo]);
    expect((await db.query("select title from public.entries where id=$1", [rows.photo])).rows).toEqual([{title: "owner edited"}]);
  });

  it("uses a non-login non-bypass role and grants no role or schema creation privilege to visitors", async () => {
    const role = (await db.query("select rolcanlogin,rolbypassrls,rolsuper,rolcreaterole from pg_roles where rolname='archive_visitor_projection'")).rows;
    expect(role).toEqual([{rolcanlogin: false, rolbypassrls: false, rolsuper: false, rolcreaterole: false}]);
    expect((await db.query("select viewowner from pg_views where schemaname='public' and viewname in ('public_entries','public_site_settings','public_media_assets')")).rows)
      .toEqual(Array.from({length: 3}, () => ({viewowner: "archive_visitor_projection"})));
    expect((await db.query("select has_schema_privilege('archive_visitor_projection','public','CREATE') allowed")).rows).toEqual([{allowed: false}]);
    for (const roleName of ["anon", "authenticated"]) {
      expect((await db.query("select pg_has_role($1,'archive_visitor_projection','MEMBER') allowed", [roleName])).rows).toEqual([{allowed: false}]);
    }
    await asRole("anon");
    await denied("create table archive_public.forged(secret text)");
    await denied("select * from archive_private.owner_registration");
  });

  it("authorizes hosted CDN GET-info only with the scoped server token and exact request path", async () => {
    // Synthetic test token; no deployment credential is used in this test.
    const token = "synthetic-public-media-proxy-token-for-tests";
    const target = storagePath(media.photo);
    const route = `/object/info/authenticated/private-media/${target}`;
    await db.query("insert into archive_public.media_read_access(token_sha256) values(encode(sha256(convert_to($1,'UTF8')),'hex'))", [token]);
    await asRole("anon");
    await denied("select * from archive_public.media_read_access");
    async function request(op: string, method: string, requestPath: string, suppliedToken?: string) {
      await db.query(`select set_config('storage.operation',$1,false),set_config('request.method',$2,false),
        set_config('request.path',$3,false),set_config('request.headers',$4,false)`,
      [op, method, requestPath, JSON.stringify(suppliedToken ? {"x-archive-public-media-token": suppliedToken} : {})]);
      return (await db.query<{name: string}>("select name from storage.objects order by name")).rows;
    }
    expect(await request("object.get_authenticated_info", "GET", route)).toEqual([]);
    expect(await request("object.get_authenticated_info", "GET", route, "wrong-token")).toEqual([]);
    expect(await request("object.get_authenticated_info", "GET", route, token)).toEqual([{name: target}]);
    expect(await request("storage.object.get_authenticated_info", "GET", route, token)).toEqual([{name: target}]);
    for (const method of ["HEAD", "POST", "PUT", "DELETE", ""]) {
      expect(await request("object.get_authenticated_info", method, route, token)).toEqual([]);
    }
    for (const requestPath of ["", "/object/info/private-media/" + target,
      route + "?versionId=historical-private-version", route + "/extra", "/rest/v1/rpc/forged"]) {
      expect(await request("object.get_authenticated_info", "GET", requestPath, token)).toEqual([]);
    }
    for (const op of ["object.sign", "object.sign_many", "object.list", "object.list_v2", "object.sign_upload_url", "storage.render.image_sign"]) {
      expect(await request(op, "GET", route, token)).toEqual([]);
    }
    for (const hidden of [media.private, media.draft, media.orphan]) {
      expect(await request("object.get_authenticated_info", "GET", `/object/info/authenticated/private-media/${storagePath(hidden)}`, token)).toEqual([]);
    }
    expect(await request("object.get_authenticated_info", "GET", `/object/info/authenticated/private-theme/${owner}/theme-media/stage.jpg`, token)).toEqual([]);
    await asRole("authenticated", owner);
    await db.query("update public.entries set is_public=false where id=$1", [rows.photo]);
    await asRole("anon");
    expect(await request("object.get_authenticated_info", "GET", route, token)).toEqual([]);
  });

  it("fails closed without CDN configuration and permits rotating its digest without touching owner data", async () => {
    const token = "synthetic-public-media-proxy-token-for-tests";
    const rotated = "another-synthetic-public-media-proxy-token-for-tests";
    await asRole("anon");
    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({"x-archive-public-media-token": token})]);
    expect((await db.query("select archive_public.has_media_read_token() allowed")).rows).toEqual([{allowed: false}]);
    await db.exec("reset role");
    await db.query("insert into archive_public.media_read_access(token_sha256) values(encode(sha256(convert_to($1,'UTF8')),'hex'))", [token]);
    await asRole("anon");
    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({"x-archive-public-media-token": token})]);
    expect((await db.query("select archive_public.has_media_read_token() allowed")).rows).toEqual([{allowed: true}]);
    await db.exec("reset role");
    await db.query("update archive_public.media_read_access set token_sha256=encode(sha256(convert_to($1,'UTF8')),'hex')", [rotated]);
    await asRole("anon");
    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({"x-archive-public-media-token": token})]);
    expect((await db.query("select archive_public.has_media_read_token() allowed")).rows).toEqual([{allowed: false}]);
    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({"x-archive-public-media-token": rotated})]);
    expect((await db.query("select archive_public.has_media_read_token() allowed")).rows).toEqual([{allowed: true}]);
  });

  it("can reapply safely without changing selection flags, owner metadata or uploads", async () => {
    const before = (await db.query("select id,is_public,data from public.entries order by id")).rows;
    await db.exec("commit");
    await db.exec(migration);
    await db.exec(cdnMigration);
    expect((await db.query("select id,is_public,data from public.entries order by id")).rows).toEqual(before);
    await asRole("anon");
    expect((await db.query("select id from public.public_entries")).rows).toHaveLength(5);
    await operation("object.sign");
    expect((await db.query("select name from storage.objects")).rows).toHaveLength(0);
  });
});
