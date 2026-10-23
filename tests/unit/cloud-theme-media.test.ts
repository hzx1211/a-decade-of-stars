import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
const state = vi.hoisted(() => ({authenticated: true, objects: new Map<string, {bytes: Buffer; contentType: string}>(), reads: [] as string[]}));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/server/auth", async () => {
  const {AppError} = await import("../../lib/server/errors");
  return {requireApiOwner: async () => {if (!state.authenticated) throw new AppError(401, "请先登录"); return {id: "cloud-owner"};}};
});
vi.mock("../../lib/supabase/server", () => ({createSupabaseServerClient: async () => ({storage: {from: (bucket: string) => {
  expect(bucket).toBe("private-theme");
  return {
    info: async (key: string) => {state.reads.push(key); const value = state.objects.get(key); return value ? {data: {size: value.bytes.length, contentType: value.contentType}, error: null} : {data: null, error: {statusCode: "404", message: "Object not found"}};},
    createSignedUrl: async (key: string, expires: number) => {expect(expires).toBe(60); return {data: {signedUrl: `https://synthetic-storage.example/${key}`}, error: null};},
  };
}}})}));
import {hasThemeMedia, privateImageResponse, readCloudThemeFile, readThemeMedia} from "../../lib/server/theme-media";
import {readStarseaFrame, readStarseaFrameManifest} from "../../lib/server/starsea-frames";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
function put(key: string, bytes: Buffer, contentType: string) {state.objects.set(`cloud-owner/${key}`, {bytes, contentType});}
beforeEach(() => {
  vi.stubEnv("DATA_MODE", "supabase"); state.authenticated = true; state.objects.clear(); state.reads = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {const value = state.objects.get(new URL(url).pathname.slice(1)); return value ? new Response(new Uint8Array(value.bytes)) : new Response(null, {status: 404});}));
});
afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals();});

describe("private theme Storage integration", () => {
  it("streams fixed owner theme images with private response headers and empty HEAD", async () => {
    put("theme-media/v-reference.png", png, "image/png");
    const media = await readThemeMedia("v-reference"); expect(media && "stream" in media).toBe(true);
    const response = privateImageResponse(media!);
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("content-length")).toBe(String(png.length));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(await privateImageResponse((await readThemeMedia("v-reference"))!, true).text()).toBe("");
    expect(state.reads.every(key => key === "cloud-owner/theme-media/v-reference.png")).toBe(true);
  });
  it("returns absent cloud themes without attempting a local private-data fallback", async () => {
    expect(await readThemeMedia("stage")).toBeNull(); expect(await hasThemeMedia("beidou")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires an owner before inspecting cloud objects and rejects arbitrary paths", async () => {
    state.authenticated = false;
    await expect(readThemeMedia("stage")).rejects.toMatchObject({status: 401}); expect(state.reads).toEqual([]);
    state.authenticated = true;
    for (const key of ["../.env", "starsea-v2/../private.png", "theme-media/other.png", "starsea-v2/frame.svg"]) await expect(readCloudThemeFile(key, 1024)).rejects.toMatchObject({status: 404});
    expect(state.reads).toEqual([]);
  });
  it("uses a bounded JSON manifest and filters unlisted, missing or invalid frame content", async () => {
    put("starsea-v2/manifest.json", Buffer.from(JSON.stringify({version: 1, frames: [{file: "frame.png", label: "私有星海"}, {file: "../private.png"}, {file: "invalid.png"}, {file: "missing.png"}]})), "application/json");
    put("starsea-v2/frame.png", png, "image/png"); put("starsea-v2/invalid.png", Buffer.from("<html>not an image</html>"), "image/png");
    expect(await readStarseaFrameManifest()).toEqual({version: 1, frames: [{src: "/api/starsea-frames/frame.png", label: "私有星海"}]});
    const frame = await readStarseaFrame("frame.png");
    expect(Buffer.from(await privateImageResponse(frame).arrayBuffer())).toEqual(png);
    await expect(readStarseaFrame("unlisted.png")).rejects.toMatchObject({status: 404});
    expect(state.reads.some(key => key.includes("../"))).toBe(false);
  });
  it("rejects mismatched theme MIME types and oversized manifests before downloading", async () => {
    put("theme-media/v-reference.png", png, "text/html"); expect(await readThemeMedia("v-reference")).toBeNull();
    put("starsea-v2/manifest.json", Buffer.alloc(64 * 1024 + 1), "application/json");
    vi.mocked(fetch).mockClear(); expect(await readStarseaFrameManifest()).toEqual({version: 1, frames: []}); expect(fetch).not.toHaveBeenCalled();
  });
});
