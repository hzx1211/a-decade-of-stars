// @vitest-environment jsdom
import React from "react";
import {afterEach, beforeEach, describe, expect, it, vi, type Mock} from "vitest";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {EntryEditor} from "../../components/entry-editor";
import {MotionScope} from "../../components/motion";
import {defaultSettings, type Asset, type Entry} from "../../lib/types";

class UploadRequest {
  static sent: UploadRequest[] = [];
  readyState = 1;
  status = 0;
  responseType = "";
  response: unknown;
  upload = {onprogress: null as ((event: ProgressEvent) => void) | null};
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  body: FormData | null = null;
  open() {}
  send(body: FormData) { this.body = body; UploadRequest.sent.push(this); }
  abort() { this.readyState = 4; this.onabort?.(); }
  complete(asset: Asset) { this.readyState = 4; this.status = 201; this.response = {asset}; this.onload?.(); }
  fail() { this.readyState = 4; this.onerror?.(); }
}

const asset: Asset = {id: "10000000-0000-4000-8000-000000000001", ownerId: "test-owner", filename: "合成验收照片.png", mimeType: "image/png", size: 128, mediaType: "image", storagePath: "test/synthetic-photo.png", rightsStatus: "personal_only", rightsHolder: "合成测试文件作者", licenseNotes: "本人生成的合成验收图片，允许本测试私人保存", allowedUseScope: ["private_storage"], createdAt: "2026-10-18T00:00:00.000Z"};
const entry: Entry = {id: "10000000-0000-4000-8000-000000000002", ownerId: "test-owner", kind: "photos", title: "合成照片验收记录", data: {rightsHolder: asset.rightsHolder, licenseNotes: asset.licenseNotes, allowedUseScope: ["private_storage", "private_playback"]}, favorite: false, createdAt: asset.createdAt, updatedAt: asset.createdAt};
let createObjectURL: Mock<(object: Blob | MediaSource) => string>;
let revokeObjectURL: Mock<(url: string) => void>;

beforeEach(() => {
  UploadRequest.sent = [];
  vi.stubGlobal("XMLHttpRequest", UploadRequest);
  createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => "blob:clearly-synthetic-photo");
  revokeObjectURL = vi.fn<(url: string) => void>();
  const NativeUrl = URL;
  vi.stubGlobal("URL", class extends NativeUrl {
    static createObjectURL(object: Blob | MediaSource) { return createObjectURL(object) as string; }
    static revokeObjectURL(url: string) { revokeObjectURL(url); }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function openEditor(overrides: Partial<React.ComponentProps<typeof EntryEditor>> = {}) {
  const onClose = vi.fn(), onSaved = vi.fn(), onAsset = vi.fn();
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({entry: {...entry, data: {...entry.data, assetId: asset.id}}}), {status: 200}));
  vi.stubGlobal("fetch", fetcher);
  const view = render(React.createElement(MotionScope, {enabled: false} as React.ComponentProps<typeof MotionScope>, React.createElement(EntryEditor, {kind: "photos", entry, entries: [entry], assets: [], settings: defaultSettings, onClose, onSaved, onAsset, ...overrides})));
  return {onClose, onSaved, onAsset, fetcher, ...view};
}

function choose(section: HTMLElement = screen.getByRole("region", {name: "上传媒体文件"}), filename = asset.filename) {
  fireEvent.change(within(section).getByTestId("upload-file"), {target: {files: [new File(["clearly synthetic test image"], filename, {type: filename.endsWith(".wav") ? "audio/wav" : "image/png"})]}});
}
function upload(section: HTMLElement = screen.getByRole("region", {name: "上传媒体文件"})) {
  fireEvent.click(within(section).getByTestId("upload-submit"));
}

describe("photo editor upload completion", () => {
  it("blocks an unuploaded selection, shows its preview and can explicitly discard it", () => {
    const {fetcher, unmount} = openEditor();
    choose();
    expect(screen.getByRole("img", {name: `待上传照片预览：${asset.filename}`} ).getAttribute("src")).toBe("blob:clearly-synthetic-photo");
    fireEvent.click(screen.getByTestId("entry-save"));
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("尚未完成上传");
    expect((screen.getByRole("button", {name: /更多设置/}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", {name: "移除所选文件"}));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:clearly-synthetic-photo");
    expect((screen.getByRole("button", {name: /更多设置/}) as HTMLButtonElement).disabled).toBe(false);
    choose();
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("locks submission and dismissal while uploading, then saves the returned photo association", async () => {
    const {fetcher, onAsset, onSaved, onClose} = openEditor();
    choose(); upload();
    expect(UploadRequest.sent).toHaveLength(1);
    expect([...UploadRequest.sent[0].body!.keys()]).toEqual(["file"]);
    expect(screen.queryByLabelText("素材权利人")).toBeNull();
    expect(screen.queryByLabelText("使用依据")).toBeNull();
    expect(screen.queryByRole("checkbox", {name: /访客|公开/})).toBeNull();
    expect((screen.getByTestId("entry-save") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", {name: "取消"}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", {name: "关闭弹窗"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(document.querySelector("form")!);
    fireEvent.keyDown(document, {key: "Escape"});
    expect(fetcher).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    act(() => UploadRequest.sent[0].complete(asset));
    expect(onAsset).toHaveBeenCalledWith(asset);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByText(`${asset.filename} 已上传，请保存当前记录以完成关联`)).toBeTruthy();
    expect((screen.getByTestId("entry-save") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("entry-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(JSON.parse(fetcher.mock.calls[0][1].body).data.assetId).toBe(asset.id);
    expect(fetcher.mock.calls[0][0]).toBe(`/api/entries/${entry.id}`);
  });

  it("keeps a failed upload pending until retried or removed", () => {
    const {fetcher} = openEditor();
    choose(); upload();
    act(() => UploadRequest.sent[0].fail());
    fireEvent.click(screen.getByTestId("entry-save"));
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map(element => element.textContent).join(" ")).toContain("尚未完成上传");
    expect(screen.getAllByRole("alert").map(element => element.textContent).join(" ")).toContain("连接中断，服务端保存状态尚未确认");
    expect((screen.getByRole("button", {name: "关闭弹窗"}) as HTMLButtonElement).disabled).toBe(false);
  });

  it("guides empty photo records to the file controls and previews associated library images", async () => {
    const {fetcher} = openEditor();
    fireEvent.click(screen.getByTestId("entry-save"));
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("还没有添加照片文件");
    expect(screen.getByRole("region", {name: "上传媒体文件"})).toBeTruthy();
    cleanup();
    const associated = openEditor({entry: {...entry, data: {...entry.data, assetId: asset.id}}, assets: [asset]});
    const preview = screen.getByRole("img", {name: `已关联照片预览：${asset.filename}`});
    expect(preview.getAttribute("src")).toBe(`/api/assets/${asset.id}`);
    expect(screen.queryByRole("region", {name: "上传媒体文件"})).toBeNull();
    fireEvent.click(screen.getByTestId("entry-save"));
    await waitFor(() => expect(associated.onSaved).toHaveBeenCalled());
    expect(JSON.parse(associated.fetcher.mock.calls[0][1].body).data.assetId).toBe(asset.id);
  });

  it("keeps independent audio and cover uploads locked until both transports finish", async () => {
    const musicEntry: Entry = {...entry, kind: "music"};
    const {fetcher, onSaved} = openEditor({kind: "music", entry: musicEntry});
    fireEvent.click(screen.getByRole("button", {name: /更多设置/}));
    fireEvent.click(screen.getByRole("button", {name: "媒体与来源"}));
    const audioSection = await screen.findByRole("region", {name: "上传媒体文件"});
    const coverSection = screen.getByRole("region", {name: "上传封面"});
    choose(audioSection, "合成音频.wav"); choose(coverSection); upload(audioSection); upload(coverSection);
    expect(UploadRequest.sent).toHaveLength(2);
    const audioAsset: Asset = {...asset, id: "10000000-0000-4000-8000-000000000003", mediaType: "audio", mimeType: "audio/wav"};
    act(() => UploadRequest.sent[0].complete(audioAsset));
    expect((screen.getByTestId("entry-save") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", {name: "关闭弹窗"}) as HTMLButtonElement).disabled).toBe(true);
    act(() => UploadRequest.sent[1].complete(asset));
    expect((screen.getByTestId("entry-save") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("entry-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(JSON.parse(fetcher.mock.calls[0][1].body).data).toMatchObject({assetId: audioAsset.id, coverAssetId: asset.id});
  });
});
