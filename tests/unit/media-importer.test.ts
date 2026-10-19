// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MediaImporter } from "../../components/media-importer";
import { MotionScope } from "../../components/motion";
import { importEntryPayload, importFileError, importTitle } from "../../lib/media-import";
import { createEntrySchema, patchEntrySchema } from "../../lib/validation/schemas";
import { defaultSettings, type Asset, type Entry } from "../../lib/types";

class UploadRequest {
  static sent: UploadRequest[] = [];
  readyState = 1;
  status = 0;
  responseType = "";
  response: unknown;
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  body: FormData | null = null;
  url = "";
  open(_method: string, url: string) { this.url = url; }
  send(body: FormData) { this.body = body; UploadRequest.sent.push(this); }
  abort() { this.readyState = 4; this.onabort?.(); }
  complete(asset: Asset) { this.readyState = 4; this.status = 201; this.response = { asset }; this.onload?.(); }
}

beforeEach(() => { UploadRequest.sent = []; vi.stubGlobal("XMLHttpRequest", UploadRequest); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const asset: Asset = { id: "10000000-0000-4000-8000-000000000001", ownerId: "test-owner", filename: "明确标记的测试音频.wav", mimeType: "audio/wav", size: 128, mediaType: "audio", storagePath: "test/fixture.wav", rightsStatus: "personal_only", rightsHolder: "合成测试文件作者", licenseNotes: "本人生成的测试音频，允许本测试私人保存和播放", allowedUseScope: ["private_storage", "private_playback"], createdAt: "2026-10-15T00:00:00.000Z" };
const entry: Entry = { id: "10000000-0000-4000-8000-000000000002", ownerId: "test-owner", ...importEntryPayload("music", "测试音频", asset), favorite: false, createdAt: asset.createdAt, updatedAt: asset.createdAt };

function setup(kind: "music" | "videos" | "photos" = "music", props: Partial<React.ComponentProps<typeof MediaImporter>> = {}) {
  const onSaved = vi.fn(), onAsset = vi.fn(), onClose = vi.fn();
  render(React.createElement(MotionScope, { enabled: false } as React.ComponentProps<typeof MotionScope>, React.createElement(MediaImporter, { kind, entries: [], assets: [], settings: defaultSettings, onClose, onSaved, onAsset, ...props })));
  return { onSaved, onAsset, onClose };
}

function choose(name = "测试音频.wav", type = "audio/wav") {
  fireEvent.change(screen.getByLabelText(/选择.*文件/), { target: { files: [new File(["clearly synthetic test media"], name, { type })] } });
}

describe("simple private media import", () => {
  it("uses filenames without inventing provenance and checks size and format before transport", () => {
    expect(importTitle("C:\\Music\\合成验收音频.demo.wav")).toBe("合成验收音频.demo");
    expect(importFileError("music", { name: "fixture.mp4", size: 10 }, 50)).toContain("格式");
    expect(importFileError("videos", { name: "fixture.mp4", size: 101 * 1024 * 1024 }, 100)).toContain("100 MB");
    setup();
    choose("不支持的合成文件.txt", "text/plain");
    expect(screen.getByRole("alert").textContent).toContain("格式");
    expect(UploadRequest.sent).toHaveLength(0);
    choose();
    expect((screen.getByLabelText("标题", { exact: true }) as HTMLInputElement).value).toBe("测试音频");
    expect(screen.queryByLabelText("权利人", { exact: true })).toBeNull();
    expect(screen.queryByLabelText("使用依据", { exact: true })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.submit(document.querySelector("form")!);
    expect(UploadRequest.sent).toHaveLength(1);
    expect([...UploadRequest.sent[0].body!.keys()]).toEqual(["file"]);
  });

  it("uploads once, preserves the asset on entry failure and retries only entry creation", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "合成的保存失败" }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entry }), { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    const { onSaved, onAsset } = setup();
    choose();
    fireEvent.click(screen.getByTestId("media-import-submit"));
    expect(UploadRequest.sent).toHaveLength(1);
    expect(UploadRequest.sent[0].url).toBe("/api/assets");
    const form = UploadRequest.sent[0].body!;
    expect([...form.keys()]).toEqual(["file"]);
    UploadRequest.sent[0].complete(asset);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("无需重新上传"));
    expect(onAsset).toHaveBeenCalledTimes(1);
    expect(onAsset).toHaveBeenCalledWith(asset);
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("标题", { exact: true }), { target: { value: "重试时修改的标题" } });
    fireEvent.click(screen.getByRole("button", { name: "重试保存记录" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(entry));
    expect(UploadRequest.sent).toHaveLength(1);
    expect(onAsset).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[1][0]).toBe("/api/entries?kind=music");
    const payload = JSON.parse(fetcher.mock.calls[2][1].body);
    expect(payload.title).toBe("重试时修改的标题");
    expect(payload.data.assetId).toBe(asset.id);
    expect(payload.data.artist).toBe("张杰");
    expect(createEntrySchema.safeParse(payload).success).toBe(true);
  });

  it("recovers a committed record after a lost response instead of creating it twice", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("合成的连接中断"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entries: [entry] }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const { onSaved } = setup();
    choose();
    fireEvent.click(screen.getByTestId("media-import-submit"));
    UploadRequest.sent[0].complete(asset);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("保存未确认"));
    fireEvent.click(await screen.findByRole("button", { name: "重试保存记录" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(entry));
    expect(fetcher.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
    expect(UploadRequest.sent).toHaveLength(1);
  });

  it("uploads photos with only the selected file and an editable title", async () => {
    const photoAsset: Asset = { ...asset, mediaType: "image", filename: "合成验收照片.png", mimeType: "image/png", allowedUseScope: ["private_storage"] };
    const photoEntry = { ...entry, ...importEntryPayload("photos", "合成验收照片", photoAsset) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ entry: photoEntry }), { status: 201 })));
    const { onSaved } = setup("photos");
    choose("合成验收照片.png", "image/png");
    fireEvent.click(screen.getByTestId("media-import-submit"));
    expect([...UploadRequest.sent[0].body!.keys()]).toEqual(["file"]);
    UploadRequest.sent[0].complete(photoAsset);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(photoEntry));
    const video = importEntryPayload("videos", "合成验收视频", { ...asset, mediaType: "video" });
    expect(video.data.category).toBe("演唱会现场");
  });

  it("adds audio to an existing entry without overwriting its title or archived fields", async () => {
    const target: Entry = { ...entry, title: "既有作品的合成验收记录", favorite: true, data: {
      artist: "保留的艺术家字段", category: "专辑曲目", year: 2009,
      albumId: "10000000-0000-4000-8000-000000000005", tags: ["合成验收"], description: "需保留的已有说明",
      relatedIds: ["10000000-0000-4000-8000-000000000006"], coverAssetId: "10000000-0000-4000-8000-000000000007",
      rightsHolder: "原有来源", licenseNotes: "原有来源说明", sourceUrl: "https://example.com/old-source", licenseType: "原有许可类型", attribution: "原有署名",
    } };
    const uploaded: Asset = {...asset, rightsHolder: undefined, licenseNotes: undefined};
    const updated = { ...target, ...importEntryPayload("music", target.title, uploaded, target) };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ entry: updated }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const { onSaved } = setup("music", { targetEntry: target, entries: [target] });
    expect((screen.getByLabelText("标题", { exact: true }) as HTMLInputElement).value).toBe(target.title);
    choose("不同的本地文件名.wav");
    expect((screen.getByLabelText("标题", { exact: true }) as HTMLInputElement).value).toBe(target.title);
    fireEvent.click(screen.getByTestId("media-import-submit"));
    UploadRequest.sent[0].complete(uploaded);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect(fetcher.mock.calls[0][0]).toBe(`/api/entries/${target.id}`);
    expect(fetcher.mock.calls[0][1].method).toBe("PATCH");
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(patchEntrySchema.safeParse(payload).success).toBe(true);
    expect(payload.kind).toBeUndefined();
    expect(payload.title).toBe(target.title);
    expect(payload.favorite).toBe(true);
    expect(payload.data).toMatchObject({ ...target.data, assetId: asset.id });
  });

  it("recovers an uncertain target PATCH only when both target id and uploaded asset match", async () => {
    const target: Entry = { ...entry, title: "目标记录验收", data: { year: 2009, tags: ["保留"] } };
    const updated = { ...target, ...importEntryPayload("music", target.title, asset, target) };
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("合成连接中断"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entry: updated }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const { onSaved } = setup("music", { targetEntry: target, entries: [{ ...updated, id: "10000000-0000-4000-8000-000000000099" }] });
    choose(); fireEvent.click(screen.getByTestId("media-import-submit"));
    UploadRequest.sent[0].complete(asset);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("保存未确认"));
    fireEvent.click(await screen.findByRole("button", { name: "重试保存记录" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect(fetcher.mock.calls).toHaveLength(2);
    expect(fetcher.mock.calls[1][0]).toBe(`/api/entries/${target.id}`);
    expect(fetcher.mock.calls.filter(call => call[1]?.method === "PATCH")).toHaveLength(1);
    expect(fetcher.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(0);
  });

  it("cancels only the upload transport and does not claim the server deleted a saved file", async () => {
    const { onClose, onAsset } = setup();
    choose();
    fireEvent.click(screen.getByTestId("media-import-submit"));
    expect((screen.getByRole("button", { name: "关闭弹窗" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await screen.findByRole("button", { name: "取消上传" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("服务端保存状态尚未确认"));
    expect(onAsset).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "关闭弹窗" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
