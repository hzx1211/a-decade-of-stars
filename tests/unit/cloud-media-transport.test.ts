// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {uploadMedia} from "../../lib/media-upload";
import type {Asset} from "../../lib/types";

class DirectRequest {
  static requests: DirectRequest[] = [];
  status = 0; response: unknown; responseType = ""; method = ""; url = ""; body?: File | FormData;
  headers = new Map<string, string>();
  upload = {onprogress: null as ((event: {lengthComputable: boolean; loaded: number; total: number}) => void) | null};
  onload: (() => void) | null = null; onabort: (() => void) | null = null; onerror: (() => void) | null = null;
  open(method: string, url: string) {this.method = method; this.url = url;}
  setRequestHeader(name: string, value: string) {this.headers.set(name, value);}
  send(body: File | FormData) {this.body = body; DirectRequest.requests.push(this);}
  abort() {this.onabort?.();}
  finish(status = 200) {this.status = status; this.onload?.();}
}
const intentId = "10000000-0000-4000-8000-000000000001";
const initialized = {intentId, signedUrl: "https://test.storage.example/signed-put?token=synthetic", mimeType: "image/png"};
const asset = {id: intentId, mediaType: "image"} as Asset;
const file = new File(["clearly synthetic transport test"], "fixture.png", {type: "image/png"});
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function untilUploaded() {for (let i = 0; i < 50 && !DirectRequest.requests.length; i++) await tick(); expect(DirectRequest.requests).toHaveLength(1); return DirectRequest.requests[0];}
function callbacks() {return {onUploaded: vi.fn(), onError: vi.fn(), onProgress: vi.fn()};}
function json(value: unknown, status = 200) {return new Response(JSON.stringify(value), {status});}

beforeEach(() => {vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "supabase"); DirectRequest.requests = []; vi.stubGlobal("XMLHttpRequest", DirectRequest);});
afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals();});

describe("direct browser media transport", () => {
  it("sends a small init and completion JSON while raw bytes only use signed PUT", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(initialized, 201)).mockResolvedValueOnce(json({asset}, 201));
    vi.stubGlobal("fetch", fetcher); const cb = callbacks(); uploadMedia(file, cb);
    const xhr = await untilUploaded();
    expect(xhr.method).toBe("PUT"); expect(xhr.url).toBe(initialized.signedUrl); expect(xhr.body).toBe(file);
    expect(xhr.headers.get("Content-Type")).toBe("image/png"); expect(xhr.headers.get("x-upsert")).toBe("false");
    xhr.upload.onprogress?.({lengthComputable: true, loaded: 30, total: 30});
    expect(cb.onProgress).toHaveBeenLastCalledWith(99);
    xhr.finish(); await tick();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/assets/uploads/init", "/api/assets/uploads/complete"]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({filename: file.name, mimeType: file.type, size: file.size});
    expect(fetcher.mock.calls[0][1].body.length).toBeLessThan(1000);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({intentId});
    expect(cb.onUploaded).toHaveBeenCalledWith(asset); expect(cb.onError).not.toHaveBeenCalled();
  });
  it("aborts raw upload and cleans up its intent without completing", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(initialized)).mockResolvedValueOnce(json({ok: true}));
    vi.stubGlobal("fetch", fetcher); const cb = callbacks(); const handle = uploadMedia(file, cb);
    await untilUploaded(); handle.abort(); await tick();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/assets/uploads/init", "/api/assets/uploads/cancel"]);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({intentId}); expect(cb.onUploaded).not.toHaveBeenCalled();
    expect(cb.onError).toHaveBeenCalledWith(expect.stringContaining("已停止本次传输"));
  });
  it("finishes an interrupted initialization long enough to identify and clean its intent", async () => {
    let respond!: (response: Response) => void;
    const fetcher = vi.fn().mockReturnValueOnce(new Promise<Response>(resolve => {respond = resolve;})).mockResolvedValueOnce(json({ok: true}));
    vi.stubGlobal("fetch", fetcher); const cb = callbacks(); const handle = uploadMedia(file, cb);
    for (let i = 0; i < 50 && !fetcher.mock.calls.length; i++) await tick();
    handle.abort(); respond(json(initialized)); await tick();
    expect(DirectRequest.requests).toHaveLength(0);
    expect(fetcher.mock.calls[1][0]).toBe("/api/assets/uploads/cancel"); expect(cb.onUploaded).not.toHaveBeenCalled();
  });
  it("surfaces the server's effective size limit before creating a file request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({error: "此类媒体云端当前上限为 50 MB"}, 413)));
    const cb = callbacks(); uploadMedia(file, cb);
    for (let i = 0; i < 50 && !cb.onError.mock.calls.length; i++) await tick();
    expect(cb.onError).toHaveBeenCalledWith("此类媒体云端当前上限为 50 MB"); expect(DirectRequest.requests).toHaveLength(0);
  });
  it("retries a lost completion response without transmitting the file twice", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(initialized)).mockRejectedValueOnce(new TypeError("synthetic network loss")).mockResolvedValueOnce(json({asset}));
    vi.stubGlobal("fetch", fetcher); const cb = callbacks(); uploadMedia(file, cb);
    (await untilUploaded()).finish(); await tick();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/assets/uploads/init", "/api/assets/uploads/complete", "/api/assets/uploads/complete"]);
    expect(DirectRequest.requests).toHaveLength(1); expect(cb.onUploaded).toHaveBeenCalledWith(asset);
  });
  it("suppresses callbacks after the owning component unmounts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(initialized)).mockResolvedValueOnce(json({ok: true})));
    const cb = callbacks(); const handle = uploadMedia(file, cb); await untilUploaded(); handle.detach(); await tick();
    expect(cb.onUploaded).not.toHaveBeenCalled(); expect(cb.onError).not.toHaveBeenCalled();
  });
});
