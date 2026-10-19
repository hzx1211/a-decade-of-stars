// @vitest-environment jsdom
import React from "react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {EntryEditor} from "../../components/entry-editor";
import {MotionScope} from "../../components/motion";
import {defaultSettings, type Entry} from "../../lib/types";

afterEach(() => {cleanup(); vi.unstubAllGlobals();});

const owner = "10000000-0000-4000-8000-000000000001";
const assetId = "10000000-0000-4000-8000-000000000002";
const resultEntry: Entry = {id: owner, ownerId: owner, kind: "music", title: "测试音乐记录", data: {}, favorite: false, createdAt: "2026-10-18T00:00:00.000Z", updatedAt: "2026-10-18T00:00:00.000Z"};
const canonical = "https://music.163.com/song?id=28059417";

function openEditor(entry?: Entry) {
  const onSaved = vi.fn();
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({entry: resultEntry}), {status: 200, headers: {"Content-Type": "application/json"}}));
  vi.stubGlobal("fetch", fetcher);
  render(React.createElement(MotionScope, {enabled: false} as React.ComponentProps<typeof MotionScope>, React.createElement(EntryEditor, {
    kind: "music", entry, entries: [], assets: [], settings: defaultSettings, onClose: vi.fn(), onSaved, onAsset: vi.fn(),
  })));
  fireEvent.change(screen.getByLabelText("标题", {exact: true}), {target: {value: "测试音乐记录"}});
  return {fetcher, onSaved};
}

async function save(fetcher: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole("button", {name: "保存记录"}));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  return JSON.parse(fetcher.mock.calls[0][1].body) as {data: Record<string, unknown>};
}

describe("music editor NetEase source", () => {
  it("converts the official iframe into a canonical song URL and selects the official player", async () => {
    const {fetcher} = openEditor();
    fireEvent.change(screen.getByPlaceholderText("粘贴网易云歌曲链接或 iframe 代码"), {target: {value: '<iframe frameborder="no" border="0" width="330" height="86" src="//music.163.com/outchain/player?type=2&id=28059417&auto=1&height=66"></iframe>'}});
    const payload = await save(fetcher);
    expect(payload.data.externalUrl).toBe(canonical);
    expect(payload.data.sourceType).toBe("official_embed");
    expect(payload.data.allowedUseScope).toContain("official_embed");
    expect(JSON.stringify(payload.data)).not.toContain("<iframe");
  });

  it("accepts a standard NetEase song page and ordinary platform links", async () => {
    const netease = openEditor();
    fireEvent.change(screen.getByPlaceholderText("粘贴网易云歌曲链接或 iframe 代码"), {target: {value: "https://music.163.com/#/outchain/2/28059417/"}});
    expect((await save(netease.fetcher)).data).toMatchObject({externalUrl: canonical, sourceType: "official_embed"});

    cleanup();
    vi.unstubAllGlobals();
    const ordinary = openEditor();
    fireEvent.change(screen.getByPlaceholderText("粘贴网易云歌曲链接或 iframe 代码"), {target: {value: "https://example.com/listen?id=42"}});
    expect((await save(ordinary.fetcher)).data).toMatchObject({externalUrl: "https://example.com/listen?id=42", sourceType: "external_link"});
  });

  it("rejects non-NetEase iframe markup without sending it to the save API", async () => {
    const {fetcher, onSaved} = openEditor();
    fireEvent.change(screen.getByPlaceholderText("粘贴网易云歌曲链接或 iframe 代码"), {target: {value: '<iframe src="https://evil.example/player?id=1"></iframe>'}});
    fireEvent.click(screen.getByRole("button", {name: "保存记录"}));
    expect((await screen.findByRole("alert")).textContent).toContain("仅支持网易云官方播放器");
    expect(fetcher).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps both the uploaded audio and platform URL when switching playback back to local", async () => {
    const entry: Entry = {...resultEntry, data: {
      assetId, externalUrl: canonical, sourceType: "official_embed", allowedUseScope: ["private_storage", "private_playback", "official_embed"],
    }};
    const {fetcher} = openEditor(entry);
    fireEvent.change(screen.getByLabelText("播放来源"), {target: {value: "local"}});
    const payload = await save(fetcher);
    expect(payload.data).toMatchObject({assetId, externalUrl: canonical, sourceType: "authorized_upload"});
  });
});
