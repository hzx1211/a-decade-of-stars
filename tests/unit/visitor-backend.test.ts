import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {Asset, Entry} from "../../lib/types";
import {defaultSettings} from "../../lib/types";

const identity = vi.hoisted(() => ({authenticated: false, id: "10000000-0000-4000-8000-000000000001"}));
const cloud = vi.hoisted(() => ({tables: new Map<string, Record<string, unknown>[]>(), queries: [] as {table: string; columns: string; filters: [string, unknown][]}[]}));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/server/auth", async () => {
  const {AppError} = await import("../../lib/server/errors");
  return {
    currentOwner: async () => identity.authenticated ? {id: identity.id, email: "owner@example.test"} : null,
    requireApiOwner: async () => {if (!identity.authenticated) throw new AppError(401, "请先登录", "UNAUTHENTICATED"); return {id: identity.id};},
  };
});
vi.mock("../../lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {throw new Error("Visitor reads must not use the owner's client or signed URLs");},
  createSupabasePublicClient: () => ({from: (table: string) => {
    const queryState = {table, columns: "", filters: [] as [string, unknown][]}; cloud.queries.push(queryState);
    const rows = () => (cloud.tables.get(table) || []).filter(row => queryState.filters.every(([key, value]) => row[key] === value));
    const query = {
      select(columns: string) {queryState.columns = columns; return query;},
      eq(key: string, value: unknown) {queryState.filters.push([key, value]); return query;},
      order() {return query;},
      async maybeSingle() {return {data: rows()[0] || null, error: null};},
      then(resolve: (result: {data: Record<string, unknown>[]; error: null}) => unknown) {return Promise.resolve(resolve({data: rows(), error: null}));},
    };
    return query;
  }}),
}));

import {getDatabase} from "../../lib/server/db";
import {mediaPath} from "../../lib/server/config";
import {getPublicState, getPublicAssetFile, saveLocalAsset, saveLocalEntry, saveLocalSettings} from "../../lib/server/store";
import {createEntry, deleteEntry, listEntries, updateEntry, updateSettings} from "../../lib/server/content";
import {deleteAsset, serveAsset, updateAsset, uploadAsset} from "../../lib/server/media";
import {GET as readEntry} from "../../app/api/entries/[id]/route";
import {GET as readAssets} from "../../app/api/assets/route";
import {GET as readSettings} from "../../app/api/settings/route";

const now = "2026-10-23T00:00:00.000Z";
const visibleId = "30000000-0000-4000-8000-000000000001";
const hiddenId = "30000000-0000-4000-8000-000000000002";
const draftId = "30000000-0000-4000-8000-000000000003";
const visibleAssetId = "40000000-0000-4000-8000-000000000001";
const hiddenAssetId = "40000000-0000-4000-8000-000000000002";
const draftAssetId = "40000000-0000-4000-8000-000000000003";
const heroAssetId = "40000000-0000-4000-8000-000000000004";
const coverAssetId = "40000000-0000-4000-8000-000000000005";
const otherOwnerId = "20000000-0000-4000-8000-000000000001";
const bytes = Buffer.from("synthetic-media-fixture");
let directory: string;
const asset = (id: string, ownerId = identity.id): Asset => ({id, ownerId, filename: "PRIVATE-ORIGINAL-FILENAME.png", mimeType: "image/png", mediaType: "image", size: bytes.length,
  storagePath: `${ownerId}/${id}.png`, rightsStatus: "personal_only", allowedUseScope: ["private_storage"], licenseNotes: "PRIVATE-PROOF", createdAt: now});
const entry = (id: string, isPublic: boolean, data: Entry["data"] = {}): Entry => ({id, ownerId: identity.id, kind: "photos", title: id === visibleId ? "公开精选" : "PRIVATE-TITLE", favorite: true, isPublic, createdAt: now, updatedAt: now,
  data: {status: "saved", notes: "PRIVATE-NOTE-MARKER", sourceUrl: "https://private.example/proof", rightsHolder: "PRIVATE-RIGHTS", ...data}});
const readRequest = (suffix = "", headers?: HeadersInit) => new Request(`https://archive.example/api/entries${suffix}`, {headers});
const writeRequest = (method = "POST", data: unknown = {}) => new Request("https://archive.example/api/entries", {method, headers: {Origin: "https://archive.example", "Content-Type": "application/json"}, body: JSON.stringify(data)});

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "ccmax-visitor-backend-"));
  vi.stubEnv("DATA_MODE", "local"); vi.stubEnv("STARS_DATA_DIR", directory);
  const db = getDatabase();
  for (const [id, created] of [[identity.id, now], [otherOwnerId, "2026-10-24T00:00:00.000Z"]]) db.prepare("INSERT INTO owners(id,email,password_hash,created_at) VALUES(?,?,?,?)").run(id, `${id}@example.test`, "synthetic-test-only", created);
});
beforeEach(async () => {
  vi.stubEnv("DATA_MODE", "local"); vi.stubEnv("STARS_DATA_DIR", directory); vi.stubEnv("APP_ORIGIN", "https://archive.example"); vi.stubEnv("VERCEL", "");
  identity.authenticated = false; cloud.tables.clear(); cloud.queries.length = 0;
  const db = getDatabase(); db.exec("DELETE FROM entries; DELETE FROM media_assets; DELETE FROM site_settings;");
  for (const id of [visibleAssetId, hiddenAssetId, draftAssetId, heroAssetId, coverAssetId]) {
    const item = asset(id); saveLocalAsset(item); const destination = mediaPath(item.storagePath); await mkdir(path.dirname(destination), {recursive: true}); await writeFile(destination, bytes);
  }
  saveLocalEntry(entry(hiddenId, false, {assetId: hiddenAssetId}));
  saveLocalEntry(entry(draftId, true, {status: "draft", assetId: draftAssetId}));
  saveLocalEntry(entry(visibleId, true, {description: "可分享的正文", assetId: visibleAssetId, coverAssetId, relatedIds: [hiddenId, draftId], itemIds: [hiddenId], chapters: [draftId], albumId: hiddenId}));
  saveLocalSettings(identity.id, {...defaultSettings, heroAssetId, featuredIds: [visibleId, hiddenId], hiddenModules: ["photos"], imageLimitMb: 99});
});
afterEach(() => {vi.unstubAllGlobals();});
afterAll(async () => {
  getDatabase().close(); vi.unstubAllEnvs();
  if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("ccmax-visitor-backend-")) throw new Error("Unexpected test cleanup path");
  await rm(directory, {recursive: true, force: true});
});

describe("visitor backend using real local SQLite and media", () => {
  it("returns only selected saved entries and public projections through the same read APIs", async () => {
    const {entries} = await listEntries(readRequest()); expect(entries.map(item => item.id)).toEqual([visibleId]);
    expect(entries[0]).toMatchObject({ownerId: "", favorite: false, data: {relatedIds: [], itemIds: [], chapters: []}});
    expect(entries[0].data.albumId).toBeUndefined();
    expect(JSON.stringify(entries)).not.toMatch(/PRIVATE-|private\.example|10000000-/);
    expect((await listEntries(readRequest("?q=PRIVATE-NOTE-MARKER"))).entries).toEqual([]);
    expect((await listEntries(readRequest("?kind=music"))).entries).toEqual([]);
    const response = await readEntry(readRequest(), {params: Promise.resolve({id: visibleId})});
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE-NOTE");
    const assetsResponse = await readAssets(); const {assets} = await assetsResponse.json();
    expect(assets.map((item: Asset) => item.id).sort()).toEqual([visibleAssetId, coverAssetId].sort());
    expect(JSON.stringify(assets)).not.toMatch(/PRIVATE-|10000000-/);
    const settingsResponse = await readSettings(); const {settings} = await settingsResponse.json();
    expect(settings.featuredIds).toEqual([visibleId]); expect(settings.heroAssetId).toBeUndefined();
    expect(settings.imageLimitMb).toBe(defaultSettings.imageLimitMb); expect(settings.moduleOrder).not.toContain("photos");
  });
  it("makes private, draft, missing and revoked records indistinguishable", async () => {
    for (const id of [hiddenId, draftId, crypto.randomUUID()]) {
      const response = await readEntry(readRequest(), {params: Promise.resolve({id})});
      expect(response.status).toBe(404); expect(await response.json()).toMatchObject({error: "记录不存在"});
    }
    getDatabase().prepare("UPDATE entries SET is_public=0 WHERE id=?").run(visibleId);
    const response = await readEntry(readRequest(), {params: Promise.resolve({id: visibleId})}); expect(response.status).toBe(404);
    expect((await listEntries(readRequest())).entries).toEqual([]);
  });
  it("supports public media GET HEAD Range and checks publication again for every request", async () => {
    const response = await serveAsset(readRequest(), visibleAssetId); expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).not.toContain("PRIVATE-ORIGINAL");
    expect((await serveAsset(readRequest(), coverAssetId, true)).status).toBe(200);
    const ranged = await serveAsset(readRequest("", {Range: "bytes=2-5"}), visibleAssetId);
    expect(ranged.status).toBe(206); expect(ranged.headers.get("content-range")).toBe(`bytes 2-5/${bytes.length}`); expect(Buffer.from(await ranged.arrayBuffer())).toEqual(bytes.subarray(2, 6));
    expect((await serveAsset(readRequest("", {Range: "bytes=999-"}), visibleAssetId)).status).toBe(416);
    for (const id of [hiddenAssetId, draftAssetId, heroAssetId, crypto.randomUUID()]) await expect(serveAsset(readRequest(), id)).rejects.toMatchObject({status: 404});
    getDatabase().prepare("UPDATE entries SET is_public=0 WHERE id=?").run(visibleId);
    await expect(serveAsset(readRequest(), visibleAssetId, true)).rejects.toMatchObject({status: 404});
  });
  it("does not leak another local owner's published assets", async () => {
    const id = crypto.randomUUID(); saveLocalAsset(asset(id, otherOwnerId)); saveLocalEntry({...entry(crypto.randomUUID(), true, {assetId: id}), ownerId: otherOwnerId});
    await expect(getPublicAssetFile(id)).rejects.toMatchObject({status: 404}); expect((await getPublicState()).assets.map(item => item.id)).not.toContain(id);
  });
  it("keeps all mutations owner-only and preserves the owner's complete records", async () => {
    for (const operation of [() => createEntry(writeRequest()), () => updateEntry(writeRequest("PATCH"), visibleId), () => deleteEntry(writeRequest("DELETE"), visibleId),
      () => updateSettings(writeRequest("PATCH")), () => uploadAsset(writeRequest()), () => updateAsset(writeRequest("PATCH"), visibleAssetId), () => deleteAsset(writeRequest("DELETE"), visibleAssetId)]) {
      await expect(operation()).rejects.toMatchObject({status: 401});
    }
    identity.authenticated = true;
    const {entries} = await listEntries(readRequest()); expect(entries).toHaveLength(3); expect(entries[0].data.notes).toBe("PRIVATE-NOTE-MARKER");
    const response = await readEntry(readRequest(), {params: Promise.resolve({id: hiddenId})}); expect(response.status).toBe(200); expect((await response.json()).entry.ownerId).toBe(identity.id);
    expect((await serveAsset(readRequest(), hiddenAssetId, true)).status).toBe(200);
  });
});

describe("visitor cloud adapter (mocked network; live Supabase is checked separately)", () => {
  function configureCloud(extension = "jpeg") {
    vi.stubEnv("DATA_MODE", "supabase"); vi.stubEnv("SUPABASE_OWNER_ID", identity.id); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic_test_only");
    vi.stubEnv("PUBLIC_MEDIA_READ_TOKEN", "synthetic-server-only-media-read-token");
    const item = entry(visibleId, true, {assetId: visibleAssetId});
    cloud.tables.set("public_entries", [{id: item.id, kind: item.kind, title: item.title, data: item.data, is_public: true, created_at: now, updated_at: now}]);
    cloud.tables.set("public_media_assets", [{id: visibleAssetId, mime_type: "image/jpeg", size: bytes.length, media_type: "image", storage_extension: extension, created_at: now}]);
    cloud.tables.set("public_site_settings", [{settings: defaultSettings}]);
  }
  it("reads only sanitized views, accepts actual legacy jpeg suffixes, and hides the owner and object key", async () => {
    configureCloud(); const state = await getPublicState();
    expect(state.entries.map(item => item.id)).toEqual([visibleId]); expect(state.assets).toHaveLength(1);
    expect(JSON.stringify(state)).not.toMatch(/PRIVATE-|10000000-|private\.example/);
    expect(cloud.queries.map(item => item.table)).toEqual(["public_entries", "public_media_assets", "public_site_settings"]);
    for (const query of cloud.queries) {expect(query.columns).not.toMatch(/owner_id|storage_path|filename|license/); expect(query.filters).toEqual([]);}
    expect((await getPublicAssetFile(visibleAssetId)).storagePath).toBe(`${identity.id}/${visibleAssetId}.jpeg`);
  });
  it("proxies GET and HEAD with the publishable API key without creating a signed URL", async () => {
    configureCloud(); const network = vi.fn(async (_url: string, options: RequestInit) => new Response(options.method === "HEAD" ? null : bytes.subarray(2, 6), {status: options.method === "HEAD" ? 200 : 206, headers: options.method === "HEAD" ? {} : {"Content-Range": `bytes 2-5/${bytes.length}`}}));
    vi.stubGlobal("fetch", network);
    const response = await serveAsset(readRequest("", {Range: "bytes=2-5"}), visibleAssetId); expect(response.status).toBe(206); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(2, 6));
    const [url, options] = network.mock.calls[0]; expect(url).toBe(`https://project.example/storage/v1/object/authenticated/private-media/${identity.id}/${visibleAssetId}.jpeg`);
    expect(url).not.toContain("token="); expect(new Headers(options.headers).get("apikey")).toBe("sb_publishable_synthetic_test_only");
    expect(new Headers(options.headers).get("x-archive-public-media-token")).toBe("synthetic-server-only-media-read-token");
    expect(new Headers(options.headers).get("authorization")).toBeNull(); expect(options.cache).toBe("no-store");
    expect((await serveAsset(readRequest(), visibleAssetId, true)).status).toBe(200); expect(network.mock.calls[1][1].method).toBe("HEAD");
  });
  it("rejects withdrawn assets before the network request and Storage rejection during a race", async () => {
    configureCloud(); const network = vi.fn(async () => new Response("denied", {status: 403})); vi.stubGlobal("fetch", network);
    await expect(serveAsset(readRequest(), visibleAssetId)).rejects.toMatchObject({status: 404}); expect(network).toHaveBeenCalledTimes(1);
    cloud.tables.set("public_media_assets", []); await expect(serveAsset(readRequest(), visibleAssetId)).rejects.toMatchObject({status: 404}); expect(network).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed reconstructed paths and mismatched upstream ranges", async () => {
    configureCloud("../private"); await expect(getPublicAssetFile(visibleAssetId)).rejects.toMatchObject({status: 404});
    configureCloud(); vi.stubGlobal("fetch", vi.fn(async () => new Response("bad range", {status: 206, headers: {"Content-Range": "bytes 0-8/9"}})));
    await expect(serveAsset(readRequest("", {Range: "bytes=2-5"}), visibleAssetId)).rejects.toMatchObject({status: 502});
  });
  it("fails closed when the server-only public media credential is absent", async () => {
    configureCloud(); vi.stubEnv("PUBLIC_MEDIA_READ_TOKEN", "");
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    await expect(serveAsset(readRequest(), visibleAssetId)).rejects.toMatchObject({status: 503, code: "PUBLIC_MEDIA_NOT_CONFIGURED"});
    expect(network).not.toHaveBeenCalled();
  });
});
