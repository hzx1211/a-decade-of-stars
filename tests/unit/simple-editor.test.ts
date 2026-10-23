// @vitest-environment jsdom
import React from "react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {EntryEditor} from "../../components/entry-editor";
import {MotionScope} from "../../components/motion";
import {defaultSettings, type Entry} from "../../lib/types";
import {createEntrySchema, patchEntrySchema} from "../../lib/validation/schemas";

afterEach(() => {cleanup(); vi.unstubAllGlobals();});

function editor(props: Partial<React.ComponentProps<typeof EntryEditor>> = {}) {
  const onSaved = vi.fn();
  render(React.createElement(MotionScope, {enabled: false} as React.ComponentProps<typeof MotionScope>, React.createElement(EntryEditor, {
    kind: "journal", entries: [], assets: [], settings: defaultSettings, onClose: vi.fn(), onSaved, onAsset: vi.fn(), ...props,
  })));
  return {onSaved};
}

function respond(entry: Entry) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({entry}), {status: 200, headers: {"Content-Type": "application/json"}}));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const base: Entry = {id: "10000000-0000-4000-8000-000000000001", ownerId: "test-owner", kind: "journal", title: "编辑器自动化验收记录", data: {}, favorite: false, createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z"};

describe("progressive private entry editor", () => {
  it("offers a title-only path without requiring dates, media or provenance fields", async () => {
    const fetcher = respond(base);
    const {onSaved} = editor();
    expect(document.querySelectorAll("input,select,textarea").length).toBe(4);
    expect((screen.getByRole("checkbox", {name: /公开给访客/}) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/个人笔记始终私密/)).toBeTruthy();
    expect(screen.queryByLabelText("素材权利人")).toBeNull();
    expect(screen.queryByLabelText("分类")).toBeNull();
    fireEvent.change(screen.getByLabelText("标题", {exact: true}), {target: {value: base.title}});
    fireEvent.click(screen.getByRole("button", {name: "保存记录"}));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(base));
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(fetcher.mock.calls[0][0]).toBe("/api/entries");
    expect(createEntrySchema.safeParse(payload).success).toBe(true);
    expect(payload.data.date).toBeUndefined();
    expect(payload.data.rightsHolder).toBeUndefined();
    expect(payload.data.licenseNotes).toBeUndefined();
    expect(payload.data.rightsStatus).toBeUndefined();
    expect(payload.data.allowedUseScope).toBeUndefined();
    expect(payload.isPublic).toBe(false);
  });

  it("publishes only after the owner turns on visitor access", async () => {
    const fetcher = respond(base);
    const {onSaved} = editor();
    fireEvent.change(screen.getByLabelText("标题", {exact: true}), {target: {value: base.title}});
    fireEvent.click(screen.getByRole("checkbox", {name: /公开给访客/}));
    fireEvent.click(screen.getByRole("button", {name: "保存记录"}));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(base));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({isPublic: true, data: {status: "saved"}});
  });

  it("keeps a publicly checked draft unpublished until it is saved as a record", async () => {
    const fetcher = respond({...base, data: {status: "draft"}});
    const {onSaved} = editor({entry: {...base, data: {status: "draft"}}});
    fireEvent.change(screen.getByLabelText("标题", {exact: true}), {target: {value: base.title}});
    fireEvent.click(screen.getByRole("checkbox", {name: /公开给访客/}));
    fireEvent.click(screen.getByRole("button", {name: "保存草稿"}));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({isPublic: true, data: {status: "draft"}});
  });

  it("preserves hidden media, provenance, ordering and relationships when only the title is edited", async () => {
    const entry: Entry = {...base, kind: "music", favorite: true, isPublic: true, data: {
      description: "明确标记的合成验收内容", notes: "隐藏笔记保留", date: "2009", datePrecision: "year", year: 2009,
      category: "单曲", tags: ["验收"], artist: "测试占位", albumId: "10000000-0000-4000-8000-000000000002",
      assetId: "10000000-0000-4000-8000-000000000003", coverAssetId: "10000000-0000-4000-8000-000000000004",
      externalUrl: "https://example.com/original", sourceUrl: "https://example.com/source", sourceType: "authorized_upload",
      rightsStatus: "licensed", rightsHolder: "自动化测试作者", licenseType: "测试许可", licenseNotes: "自动化验收专用",
      attribution: "保留署名", allowedUseScope: ["private_storage", "private_playback"], relatedIds: ["10000000-0000-4000-8000-000000000005"], featured: true, featuredOrder: 7, verified: true,
    }};
    const fetcher = respond(entry);
    const {onSaved} = editor({kind: "music", entry});
    expect((screen.getByRole("checkbox", {name: /公开给访客/}) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText("个人笔记")).toBeNull();
    fireEvent.change(screen.getByLabelText("标题", {exact: true}), {target: {value: "只改标题的合成验收记录"}});
    fireEvent.click(screen.getByRole("button", {name: "保存记录"}));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(fetcher.mock.calls[0][0]).toBe(`/api/entries/${entry.id}`);
    expect(fetcher.mock.calls[0][1].method).toBe("PATCH");
    expect(patchEntrySchema.safeParse(payload).success).toBe(true);
    expect(payload.data).toEqual({...entry.data, status: "saved"});
    expect(payload.favorite).toBe(true);
    expect(payload.isPublic).toBe(true);
  });

  it("keeps an advanced edit when its section is folded before saving", async () => {
    const fetcher = respond(base);
    const {onSaved} = editor();
    fireEvent.change(screen.getByLabelText("标题", {exact: true}), {target: {value: base.title}});
    const more = screen.getByRole("button", {name: /更多设置/});
    fireEvent.click(more);
    fireEvent.change(screen.getByLabelText("个人笔记"), {target: {value: "折叠后继续保留的笔记"}});
    fireEvent.click(more);
    await waitFor(() => expect(screen.queryByLabelText("个人笔记")).toBeNull());
    fireEvent.click(screen.getByRole("button", {name: "保存记录"}));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(JSON.parse(fetcher.mock.calls[0][1].body).data.notes).toBe("折叠后继续保留的笔记");
  });
});
