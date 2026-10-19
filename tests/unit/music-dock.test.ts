// @vitest-environment jsdom
import React from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {MusicDock} from "../../components/music-dock";
import {MotionScope} from "../../components/motion";
import type {Asset, Entry} from "../../lib/types";

type Music = React.ComponentProps<typeof MusicDock>["music"];
const entry: Entry = {id: "track-a", ownerId: "test-owner", kind: "music", title: "合成验收歌曲甲", favorite: false, createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z", data: {artist: "验收样本", assetId: "asset-a"}};
const asset: Asset = {id: "asset-a", ownerId: "test-owner", filename: "synthetic.wav", mimeType: "audio/wav", size: 128, mediaType: "audio", storagePath: "test/synthetic.wav", rightsStatus: "personal_only", allowedUseScope: ["private_storage", "private_playback"], createdAt: entry.createdAt};
const track = {entry, asset};
const nextTrack = {...track, entry: {...entry, id: "track-b", title: "合成验收歌曲乙"}};
function musicState(): Music { return {tracks: [track, nextTrack], current: track, playing: true, loading: false, time: 3, duration: 30, volume: .7, error: "", toggle: vi.fn(), move: vi.fn(), seek: vi.fn(), setVolume: vi.fn()}; }

function view(music: Music, onClose = vi.fn()) {
  return React.createElement(MotionScope, {enabled: false} as React.ComponentProps<typeof MotionScope>,
    React.createElement("button", {"data-testid": "outside"}, "外部操作"),
    React.createElement("audio", {"data-testid": "persistent-audio"}),
    React.createElement(MusicDock, {music, onClose}),
  );
}
function advance(milliseconds = 4_000) { act(() => { vi.advanceTimersByTime(milliseconds); }); }
function state() { return screen.getByTestId("music-dock-shell").getAttribute("data-state"); }

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("music dock idle presentation", () => {
  it("collapses after four seconds without stopping or replacing the audio element", () => {
    const music = musicState(), onClose = vi.fn();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    render(view(music, onClose));
    const audio = screen.getByTestId("persistent-audio");
    advance(3_999); expect(state()).toBe("expanded");
    advance(1); expect(state()).toBe("collapsed");
    expect(screen.getByRole("button", {name: "展开音乐播放器"}).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("persistent-audio")).toBe(audio);
    expect(onClose).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
    expect(music.toggle).not.toHaveBeenCalled();
  });

  it("keeps hovered controls available and starts a fresh idle period after leaving", () => {
    render(view(musicState()));
    const region = screen.getByRole("region", {name: "音乐播放器"});
    fireEvent.pointerEnter(region, {pointerType: "mouse"});
    advance(12_000); expect(state()).toBe("expanded");
    fireEvent.pointerLeave(region, {pointerType: "mouse"});
    advance(3_999); expect(state()).toBe("expanded");
    advance(1); expect(state()).toBe("collapsed");
  });

  it("does not hide keyboard controls while tabbing and resumes the timer after focus leaves", () => {
    render(view(musicState()));
    act(() => screen.getByRole("button", {name: "暂停音乐"}).focus());
    advance(12_000); expect(state()).toBe("expanded");
    fireEvent.keyDown(screen.getByRole("button", {name: "暂停音乐"}), {key: "Tab"});
    act(() => screen.getByRole("slider", {name: "播放进度"}).focus());
    fireEvent.wheel(screen.getByTestId("outside"), {deltaY: 100});
    advance(); expect(state()).toBe("expanded");
    act(() => screen.getByTestId("outside").focus());
    advance(); expect(state()).toBe("collapsed");
  });

  it("collapses while scrolling outside and does not leave mouse-focused controls pinned open", () => {
    render(view(musicState()));
    const play = screen.getByRole("button", {name: "暂停音乐"});
    fireEvent.pointerDown(play);
    act(() => play.focus());
    fireEvent.pointerUp(play);
    advance(); expect(state()).toBe("collapsed");
    const handle = screen.getByRole("button", {name: "展开音乐播放器"});
    fireEvent.pointerDown(handle); fireEvent.click(handle);
    fireEvent.pointerUp(window);
    expect(state()).toBe("expanded");
    fireEvent.wheel(screen.getByTestId("outside"), {deltaY: 120});
    expect(state()).toBe("collapsed");
  });

  it("keeps touch sliders available throughout a long drag and restarts idle time on release outside", () => {
    render(view(musicState()));
    const slider = screen.getByRole("slider", {name: "播放进度"});
    fireEvent.pointerDown(slider, {pointerType: "touch"});
    advance(8_000); expect(state()).toBe("expanded");
    fireEvent.pointerUp(window, {pointerType: "touch"});
    advance(3_999); expect(state()).toBe("expanded");
    advance(1); expect(state()).toBe("collapsed");
  });

  it("reopens accessibly and manual collapse returns focus without stopping playback", () => {
    const onClose = vi.fn();
    render(view(musicState(), onClose));
    advance();
    fireEvent.keyDown(document, {key: "Tab"});
    act(() => screen.getByRole("button", {name: "展开音乐播放器"}).focus());
    expect(state()).toBe("expanded");
    expect(document.activeElement).toBe(screen.getByRole("button", {name: "暂停音乐"}));
    advance(12_000); expect(state()).toBe("expanded");
    fireEvent.click(screen.getByRole("button", {name: "收起音乐播放器"}));
    expect(state()).toBe("collapsed");
    expect(document.activeElement).toBe(screen.getByRole("button", {name: "展开音乐播放器"}));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores playback updates while collapsed but reveals a new track and playback errors", () => {
    const music = musicState(), onClose = vi.fn();
    const result = render(view(music, onClose));
    advance(); expect(state()).toBe("collapsed");
    result.rerender(view({...music, time: 8, playing: false}, onClose));
    advance(500); expect(state()).toBe("collapsed");
    result.rerender(view({...music, current: nextTrack}, onClose));
    expect(state()).toBe("expanded");
    advance(); expect(state()).toBe("collapsed");
    result.rerender(view({...music, current: nextTrack, error: "合成的音频读取错误"}, onClose));
    expect(state()).toBe("expanded");
    expect(screen.getByRole("alert").textContent).toBe("合成的音频读取错误");
  });

  it("keeps stopping separate from collapse and restores the prior content focus", () => {
    const onClose = vi.fn();
    render(view(musicState(), onClose));
    const outside = screen.getByTestId("outside");
    act(() => outside.focus());
    act(() => screen.getByRole("button", {name: "关闭音乐播放器"}).focus());
    fireEvent.click(screen.getByRole("button", {name: "关闭音乐播放器"}));
    expect(onClose).toHaveBeenCalledTimes(1);
    advance(20);
    expect(document.activeElement).toBe(outside);
  });
});
