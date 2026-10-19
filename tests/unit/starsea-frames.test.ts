import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {lstat, mkdir, mkdtemp, open, readFile, rm, rmdir, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/server/auth", () => ({requireApiOwner: vi.fn()}));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {...actual, lstat: vi.fn(actual.lstat), open: vi.fn(actual.open)};
});

import {requireApiOwner} from "../../lib/server/auth";
import {AppError} from "../../lib/server/errors";
import {GET as manifestGet, HEAD as manifestHead} from "../../app/api/starsea-frames/route";
import {GET as frameGet, HEAD as frameHead} from "../../app/api/starsea-frames/[frame]/route";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64");
const request = new Request("http://localhost:3000/api/starsea-frames/starsea-01.png");
const context = (frame: string) => ({params: Promise.resolve({frame})});
let temporaryDirectory: string;
let framesDirectory: string;

async function manifest(frames: unknown[], directory = framesDirectory) {
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({version: 1, frames}));
}

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "starsea-frames-"));
  framesDirectory = path.join(temporaryDirectory, "assets", "generated", "starsea-v2");
  await mkdir(framesDirectory, {recursive: true});
  vi.spyOn(process, "cwd").mockReturnValue(temporaryDirectory);
  vi.mocked(requireApiOwner).mockResolvedValue({id: "owner", email: "owner@example.test"});
  vi.mocked(lstat).mockClear();
  vi.mocked(open).mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Delete only the unique test directory created above, never a computed parent.
  if (path.dirname(temporaryDirectory) !== path.resolve(tmpdir()) || !path.basename(temporaryDirectory).startsWith("starsea-frames-")) throw new Error("Unsafe test cleanup target");
  await rm(temporaryDirectory, {recursive: true, force: true});
});

describe("private generated starsea backgrounds", () => {
  it("authenticates all GET/HEAD routes before inspecting parameters or the filesystem", async () => {
    vi.mocked(requireApiOwner).mockRejectedValue(new AppError(401, "请先登录所有者账号", "UNAUTHENTICATED"));
    const then = vi.fn();
    const unreadableContext = {params: {then} as unknown as Promise<{frame: string}>};
    const responses = [await manifestGet(), await manifestHead(), await frameGet(request, unreadableContext), await frameHead(request, unreadableContext)];
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect(await responses[1].text()).toBe("");
    expect(await responses[3].text()).toBe("");
    expect(then).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("returns an empty private manifest when assets are not generated or the manifest is malformed", async () => {
    for (const content of [null, "{invalid", JSON.stringify({version: 2, frames: []}), JSON.stringify({version: 1, frames: {}})]) {
      if (content !== null) await writeFile(path.join(framesDirectory, "manifest.json"), content);
      const response = await manifestGet();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({version: 1, frames: []});
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    }
    const response = await manifestHead();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).toBe("");
  });

  it("exposes only existing listed raster frames with relative authenticated URLs", async () => {
    await writeFile(path.join(framesDirectory, "starsea-01.png"), png);
    await writeFile(path.join(framesDirectory, "wrong-type.png"), "<svg onload=\"alert(1)\" />");
    await manifest([
      {file: "starsea-01.png", label: "蓝色星海"},
      {file: "starsea-01.png", label: "duplicate"},
      {file: "missing.webp", label: "missing"},
      {file: "wrong-type.png", label: "invalid image"},
      {file: "unsafe.svg", label: "vector"},
      {file: "../../private.png", label: "traversal"},
    ]);
    const response = await manifestGet();
    expect(await response.json()).toEqual({version: 1, frames: [{src: "/api/starsea-frames/starsea-01.png", label: "蓝色星海"}]});
    const image = await frameGet(request, context("starsea-01.png"));
    expect(image.status).toBe(200);
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("content-length")).toBe(String(png.length));
    expect(image.headers.get("cache-control")).toBe("private, no-store");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(image.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    const head = await frameHead(request, context("starsea-01.png"));
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(png.length));
    expect(await head.text()).toBe("");
  });

  it("rejects traversal, unsupported types, unlisted files and unavailable images without leaking paths", async () => {
    await writeFile(path.join(framesDirectory, "unlisted.png"), png);
    await writeFile(path.join(framesDirectory, "invalid.png"), "not an image");
    await manifest([{file: "missing.png"}, {file: "invalid.png"}]);
    for (const filename of ["../manifest.json", "..\\private.png", "%2e%2e%2fprivate.png", "/private.png", "C:\\private.png", "frame.svg", "unlisted.png", "missing.png", "invalid.png"]) {
      const response = await frameGet(request, context(filename));
      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).toContain("星海背景不存在");
      expect(body).not.toContain(temporaryDirectory);
    }
  });

  it("caps the manifest at six frames and refuses oversized files", async () => {
    const frames = Array.from({length: 7}, (_, index) => ({file: `starsea-0${index + 1}.png`, label: `星海 ${index + 1}`}));
    await Promise.all(frames.map(frame => writeFile(path.join(framesDirectory, frame.file), png)));
    await manifest(frames);
    const response = await manifestGet();
    expect((await response.json()).frames).toHaveLength(6);
    expect((await frameGet(request, context(frames[6].file))).status).toBe(404);
    const oversized = Buffer.alloc(12 * 1024 * 1024 + 1);
    png.copy(oversized);
    await writeFile(path.join(framesDirectory, frames[0].file), oversized);
    const filtered = await manifestGet();
    expect((await filtered.json()).frames).toHaveLength(5);
    expect((await frameGet(request, context(frames[0].file))).status).toBe(404);
    await writeFile(path.join(framesDirectory, "manifest.json"), " ".repeat(64 * 1024 + 1));
    expect(await (await manifestGet()).json()).toEqual({version: 1, frames: []});
  });

  it("does not follow a generated-directory symlink or junction outside its fixed location", async () => {
    const relocated = path.join(temporaryDirectory, "relocated");
    await mkdir(relocated);
    await manifest([{file: "private.png", label: "must stay private"}], relocated);
    await writeFile(path.join(relocated, "private.png"), png);
    await rmdir(framesDirectory);
    await symlink(relocated, framesDirectory, "junction");
    expect(await (await manifestGet()).json()).toEqual({version: 1, frames: []});
    expect((await frameGet(request, context("private.png"))).status).toBe(404);
    expect(await readFile(path.join(relocated, "private.png"))).toEqual(png);
  });
});
