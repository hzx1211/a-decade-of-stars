import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {Asset, Entry} from "../../lib/types";
import {importEntryPayload} from "../../lib/media-import";

const identity = vi.hoisted(() => ({authenticated: true, id: "10000000-0000-4000-8000-000000000001"}));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/server/auth", () => ({
  currentOwner: async () => identity.authenticated ? {id: identity.id, email: "synthetic@example.test"} : null,
  requireApiOwner: async () => {
    if (!identity.authenticated) throw Object.assign(new Error("需要登录"), {status: 401});
    return {id: identity.id, email: "synthetic@example.test"};
  },
}));

import {getDatabase} from "../../lib/server/db";
import {mediaPath} from "../../lib/server/config";
import {getAsset, saveAsset} from "../../lib/server/store";
import {serveAsset, updateAsset, uploadAsset} from "../../lib/server/media";
import {exportBackup, importBackup} from "../../lib/server/backup";
import {validateReferences} from "../../lib/server/references";

let directory: string;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const wav = Buffer.alloc(48); wav.write("RIFF"); wav.writeUInt32LE(40, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(4, 40);
const mp4Header = Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]);
function uploadRequest(bytes = png, name = "synthetic.png", mime = "image/png", metadata: Record<string,string> = {}) {
  const form = new FormData(); form.set("file", new File([new Uint8Array(bytes)], name, {type: mime}));
  for (const [key, value] of Object.entries(metadata)) form.set(key, value);
  return new Request("http://127.0.0.1:3000/api/assets", {method: "POST", headers: {Origin: "http://127.0.0.1:3000"}, body: form});
}
function jsonRequest(body: unknown) {return new Request("http://127.0.0.1:3000/api/assets", {method: "PATCH", headers: {Origin: "http://127.0.0.1:3000", "Content-Type": "application/json"}, body: JSON.stringify(body)});}

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "ccmax-private-media-"));
  vi.stubEnv("DATA_MODE", "local"); vi.stubEnv("STARS_DATA_DIR", directory); vi.stubEnv("APP_ORIGIN", "");
  const db = getDatabase();
  for (const id of [identity.id, "20000000-0000-4000-8000-000000000002"]) db.prepare("INSERT INTO owners(id,email,password_hash,created_at) VALUES(?,?,?,?)").run(id, `${id}@example.test`, "synthetic-test-only", new Date().toISOString());
});
beforeEach(() => {identity.authenticated = true; getDatabase().exec("DELETE FROM entries; DELETE FROM media_assets;");});
afterAll(async () => {
  getDatabase().close(); vi.unstubAllEnvs();
  const target = path.resolve(directory); const temporaryRoot = path.resolve(os.tmpdir());
  if (path.dirname(target) !== temporaryRoot || !path.basename(target).startsWith("ccmax-private-media-")) throw new Error("Unexpected test cleanup path");
  await rm(target, {recursive: true, force: true});
});

describe("private media backend without mandatory proof fields", () => {
  it.each([
    ["synthetic.png", "image/png", png, "image", ["private_storage"]],
    ["synthetic.wav", "audio/wav", wav, "audio", ["private_storage", "private_playback"]],
    ["synthetic-header.mp4", "video/mp4", mp4Header, "video", ["private_storage", "private_playback"]],
  ] as const)("accepts file-only %s, stores actual bytes, and supplies private behavior defaults", async (name, mime, bytes, mediaType, scopes) => {
    const {asset} = await uploadAsset(uploadRequest(bytes, name, mime));
    expect(asset).toMatchObject({ownerId: identity.id, mediaType, rightsStatus: "personal_only", allowedUseScope: scopes});
    expect(asset.rightsHolder).toBeUndefined(); expect(asset.licenseNotes).toBeUndefined(); expect(asset.licenseType).toBeUndefined();
    expect(await getAsset(identity.id, asset.id)).toEqual(JSON.parse(JSON.stringify(asset)));
    expect(await readFile(mediaPath(asset.storagePath))).toEqual(bytes);
    const response = await serveAsset(new Request(`http://127.0.0.1:3000/api/assets/${asset.id}/file`, {headers: {Range: "bytes=0-3"}}), asset.id);
    expect(response.status).toBe(206); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(0, 4));
  });

  it("retains supplied historical metadata through an unrelated PATCH without injecting defaults", async () => {
    const {asset} = await uploadAsset(uploadRequest(png, "synthetic.png", "image/png", {rightsHolder: "原作者记录", licenseNotes: "原有说明", rightsStatus: "unknown", allowedUseScope: "[]"}));
    expect(asset.rightsStatus).toBe("unknown");
    const {asset: updated} = await updateAsset(jsonRequest({attribution: "保留的署名"}), asset.id);
    expect(updated).toMatchObject({rightsHolder: "原作者记录", licenseNotes: "原有说明", rightsStatus: "unknown", attribution: "保留的署名"});
    expect(updated.allowedUseScope).toEqual(asset.allowedUseScope);
    const response = await serveAsset(new Request(`http://127.0.0.1:3000/api/assets/${asset.id}/file`), asset.id, true);
    expect(response.status).toBe(200);
  });

  it("exports and restores real private assets with absent optional metadata", async () => {
    const {asset} = await uploadAsset(uploadRequest());
    const backup = await exportBackup();
    const preview = await importBackup(jsonRequest({action: "preview", backup}));
    expect(preview).toMatchObject({preview: {assets: {updated: 1, missing: 0}}});
    expect(await importBackup(jsonRequest({action: "restore", backup, confirmed: true}))).toMatchObject({ok: true});
    expect(await getAsset(identity.id, asset.id)).toEqual(JSON.parse(JSON.stringify(asset)));
  });

  it("keeps historical asset metadata when a merge backup omits optional fields", async () => {
    const {asset} = await uploadAsset(uploadRequest());
    const backup = await exportBackup();
    await updateAsset(jsonRequest({rightsHolder: "原作者记录", licenseNotes: "原有说明", sourceUrl: "https://example.com/source"}), asset.id);
    await importBackup(jsonRequest({action: "restore", backup, confirmed: true}));
    expect(await getAsset(identity.id, asset.id)).toMatchObject({rightsHolder: "原作者记录", licenseNotes: "原有说明", sourceUrl: "https://example.com/source"});
  });

  it("preserves previous entry metadata when a new file has no attribution fields", async () => {
    const {asset} = await uploadAsset(uploadRequest());
    const target: Entry = {id: "30000000-0000-4000-8000-000000000003", ownerId: identity.id, kind: "photos", title: "原记录", favorite: false, createdAt: asset.createdAt, updatedAt: asset.createdAt, data: {rightsHolder: "原作者记录", licenseNotes: "原有说明", sourceUrl: "https://example.com/source", licenseType: "原许可记录", attribution: "原署名", notes: "私人笔记"}};
    expect(importEntryPayload("photos", target.title, asset, target).data).toMatchObject({...target.data, assetId: asset.id, category: "照片"});
  });

  it("allows legacy private playback without proof scopes while keeping reference owner/type checks", async () => {
    const {asset} = await uploadAsset(uploadRequest(wav, "synthetic.wav", "audio/wav"));
    const historical: Asset = {...asset, allowedUseScope: [], rightsStatus: "unknown"}; await saveAsset(historical);
    const entry: Entry = {id: "30000000-0000-4000-8000-000000000003", ownerId: identity.id, kind: "music", title: "合成音调", favorite: false, createdAt: asset.createdAt, updatedAt: asset.createdAt, data: {assetId: asset.id}};
    expect(() => validateReferences(entry, [], [historical])).not.toThrow();
    expect(() => validateReferences({...entry, kind: "photos"}, [], [historical])).toThrow(/类型/);
    expect(() => validateReferences(entry, [], [{...historical, ownerId: "another-owner"}])).toThrow(/所有者/);
    expect((await serveAsset(new Request(`http://127.0.0.1:3000/api/assets/${asset.id}/file`), asset.id, true)).status).toBe(200);
  });

  it("still enforces authentication, exact origin, file signature, ownership, range and storage paths", async () => {
    identity.authenticated = false;
    await expect(uploadAsset(uploadRequest())).rejects.toMatchObject({status: 401});
    identity.authenticated = true;
    const crossSite = uploadRequest(); crossSite.headers.set("Origin", "https://evil.example");
    await expect(uploadAsset(crossSite)).rejects.toMatchObject({status: 403});
    await expect(uploadAsset(uploadRequest(Buffer.from("<script>bad()</script>")))).rejects.toMatchObject({status: 415});
    const {asset} = await uploadAsset(uploadRequest());
    identity.authenticated = false;
    await expect(serveAsset(new Request(`http://127.0.0.1:3000/api/assets/${asset.id}/file`), asset.id)).rejects.toMatchObject({status: 404});
    identity.authenticated = true;
    expect((await serveAsset(new Request(`http://127.0.0.1:3000/api/assets/${asset.id}/file`, {headers: {Range: "bytes=99999-"}}), asset.id)).status).toBe(416);
    await expect(getAsset("20000000-0000-4000-8000-000000000002", asset.id)).rejects.toMatchObject({status: 404});
    await saveAsset({...asset, storagePath: "../../outside.png"});
    expect((await getAsset(identity.id, asset.id)).storagePath).toBe(asset.storagePath);
    expect(() => mediaPath("../../outside.png")).toThrow(expect.objectContaining({status: 400}));
  });
});
