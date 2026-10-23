import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {defaultSettings, type Asset} from "../../lib/types";

const state = vi.hoisted(() => ({authenticated: true, ownerId: "10000000-0000-4000-8000-000000000001", intents: new Map<string, Record<string, unknown>>(), saved: new Map<string, Asset>()}));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/server/auth", async () => {
  const {AppError} = await import("../../lib/server/errors");
  return {requireApiOwner: async () => {if (!state.authenticated) throw new AppError(401, "请先登录"); return {id: state.ownerId};}};
});
const storage = vi.hoisted(() => ({info: vi.fn(), createSignedUrl: vi.fn(), createSignedUploadUrl: vi.fn(), remove: vi.fn()}));
vi.mock("../../lib/supabase/server", () => ({createSupabaseServerClient: async () => ({
  storage: {from: () => storage},
  from: (table: string) => {
    if (table !== "media_upload_intents") throw new Error(`Unexpected table ${table}`);
    const filters = new Map<string, unknown>(); let deleting = false;
    const filtered = () => [...state.intents.values()].find(row => [...filters].every(([key, value]) => row[key] === value));
    const query = {
      select() {return query;}, eq(key: string, value: unknown) {filters.set(key, value); return query;},
      async maybeSingle() {return {data: filtered() ?? null, error: null};},
      async insert(row: Record<string, unknown>) {state.intents.set(String(row.id), row); return {error: null};},
      delete() {deleting = true; return query;},
      then(resolve: (value: {error: null}) => unknown) {const row = filtered(); if (deleting && row) state.intents.delete(String(row.id)); return Promise.resolve(resolve({error: null}));},
    };
    return query;
  },
})}));
vi.mock("../../lib/server/store", async () => {
  const {AppError} = await import("../../lib/server/errors");
  return {
    getSettings: async () => defaultSettings,
    getAsset: async (ownerId: string, id: string) => {const asset = state.saved.get(id); if (asset?.ownerId === ownerId) return asset; throw new AppError(404, "媒体不存在");},
    saveAsset: async (asset: Asset) => {state.saved.set(asset.id, asset);},
  };
});
import {cancelAssetUpload, cloudUploadLimit, completeAssetUpload, initializeAssetUpload, serveAsset, uploadAsset} from "../../lib/server/media";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const original = {filename: "fixture.png", mimeType: "image/png", size: png.length, signature: png.toString("base64")};
function request(body: unknown, origin = "https://archive.example") {return new Request("https://archive.example/api/assets/uploads/init", {method: "POST", headers: {Origin: origin, "Content-Type": "application/json"}, body: JSON.stringify(body)});}
async function init() {return initializeAssetUpload(request(original));}

beforeEach(() => {
  vi.stubEnv("DATA_MODE", "supabase"); vi.stubEnv("APP_ORIGIN", "https://archive.example"); vi.stubEnv("CLOUD_UPLOAD_LIMIT_MB", "50");
  state.authenticated = true; state.intents.clear(); state.saved.clear();
  vi.clearAllMocks();
  storage.info.mockResolvedValue({data: {size: png.length, contentType: "image/png"}, error: null});
  storage.createSignedUploadUrl.mockResolvedValue({data: {signedUrl: "https://storage.example/upload?token=test-only"}, error: null});
  storage.createSignedUrl.mockResolvedValue({data: {signedUrl: "https://storage.example/read?token=test-only"}, error: null});
  storage.remove.mockResolvedValue({error: null});
  vi.stubGlobal("fetch", vi.fn(async () => new Response(png, {status: 206, headers: {"Content-Range": `bytes 0-${png.length - 1}/${png.length}`}})));
});
afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals();});

describe("cloud media upload intents", () => {
  it("creates an immutable owner path and only a small signed upload response", async () => {
    const initialized = await initializeAssetUpload(request({...original, filename: "C:\\fake\\fixture.png", metadata: {licenseNotes: "所有者提供的原始备注"}}));
    expect(initialized.maximumBytes).toBe(10 * 1024 * 1024);
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(`${state.ownerId}/${initialized.intentId}.png`, {upsert: false});
    expect(state.intents.get(initialized.intentId)).toMatchObject({owner_id: state.ownerId, filename: "fixture.png", mime_type: "image/png", metadata: {rightsStatus: "personal_only", allowedUseScope: ["private_storage"], licenseNotes: "所有者提供的原始备注"}});
    expect(initialized).not.toHaveProperty("token");
    expect(state.saved.size).toBe(0);
  });
  it("caps cloud uploads at the effective settings/env/free-plan limit", async () => {
    expect(cloudUploadLimit("video", 100)).toBe(50 * 1024 * 1024);
    vi.stubEnv("CLOUD_UPLOAD_LIMIT_MB", "4");
    await expect(initializeAssetUpload(request({...original, size: 4 * 1024 * 1024 + 1}))).rejects.toMatchObject({status: 413, code: "MEDIA_TOO_LARGE"});
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
    vi.stubEnv("CLOUD_UPLOAD_LIMIT_MB", "100");
    expect(() => cloudUploadLimit("video", 100)).toThrow(/配置无效/);
  });
  it("verifies actual Storage metadata and bounded bytes before creating an asset", async () => {
    const {intentId} = await init();
    const {asset} = await completeAssetUpload(request({intentId}));
    expect(asset).toMatchObject({id: intentId, ownerId: state.ownerId, size: png.length, mimeType: "image/png", rightsStatus: "personal_only", allowedUseScope: ["private_storage"]});
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({headers: {Range: `bytes=0-${png.length - 1}`}, cache: "no-store"}));
    expect(state.saved.get(intentId)).toEqual(asset);
    expect(state.intents.size).toBe(0);
    expect((await completeAssetUpload(request({intentId}))).asset).toEqual(asset);
    expect((await cancelAssetUpload(request({intentId})))).toEqual({ok: true, retained: true});
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it.each(["size", "mime", "magic"])("rejects and cleans a file whose actual %s was tampered with", async field => {
    const {intentId} = await init();
    if (field === "size") storage.info.mockResolvedValue({data: {size: png.length + 1, contentType: "image/png"}, error: null});
    if (field === "mime") storage.info.mockResolvedValue({data: {size: png.length, contentType: "text/html"}, error: null});
    if (field === "magic") vi.mocked(fetch).mockResolvedValue(new Response(Buffer.alloc(png.length), {status: 206, headers: {"Content-Range": `bytes 0-${png.length - 1}/${png.length}`}}));
    await expect(completeAssetUpload(request({intentId}))).rejects.toMatchObject({status: 415});
    expect(state.saved.size).toBe(0); expect(state.intents.size).toBe(0);
    expect(storage.remove).toHaveBeenCalledWith([`${state.ownerId}/${intentId}.png`]);
  });
  it("does not buffer an ignored Range or delete an object on transient failure", async () => {
    const {intentId} = await init(); const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({cancel}), {status: 200}));
    await expect(completeAssetUpload(request({intentId}))).rejects.toMatchObject({status: 502});
    expect(cancel).toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
    expect(state.intents.size).toBe(1); expect(state.saved.size).toBe(0);
  });
  it("does not accept client metadata, owner or path overrides during completion", async () => {
    const {intentId} = await init();
    await expect(completeAssetUpload(request({intentId, storagePath: "another-owner/fixture.png", metadata: {rightsStatus: "licensed"}}))).rejects.toThrow();
    state.intents.get(intentId)!.owner_id = "another-owner";
    await expect(completeAssetUpload(request({intentId}))).rejects.toMatchObject({status: 404});
    expect(storage.info).not.toHaveBeenCalled(); expect(state.saved.size).toBe(0);
  });
  it("cleans expired intents and allows cancellation of unfinished uploads", async () => {
    const {intentId} = await init(); state.intents.get(intentId)!.expires_at = new Date(0).toISOString();
    await expect(completeAssetUpload(request({intentId}))).rejects.toMatchObject({status: 410});
    expect(state.intents.size).toBe(0);
    const next = await init();
    expect(await cancelAssetUpload(request({intentId: next.intentId}))).toEqual({ok: true});
    expect(state.intents.size).toBe(0); expect(state.saved.size).toBe(0);
  });
  it("requires owner authentication and exact origin before signing or reading any media", async () => {
    await expect(initializeAssetUpload(request(original, "https://evil.example"))).rejects.toMatchObject({status: 403});
    state.authenticated = false;
    await expect(init()).rejects.toMatchObject({status: 401});
    await expect(completeAssetUpload(request({intentId: crypto.randomUUID()}))).rejects.toMatchObject({status: 401});
    await expect(serveAsset(new Request("https://archive.example/api/assets/invalid/file"), "invalid")).rejects.toMatchObject({status: 401});
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled(); expect(storage.info).not.toHaveBeenCalled();
  });
  it("refuses old multipart cloud upload before consuming file bytes", async () => {
    await expect(uploadAsset(request({}))).rejects.toMatchObject({code: "DIRECT_UPLOAD_REQUIRED"});
  });
});
