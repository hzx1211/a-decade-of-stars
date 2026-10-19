// @vitest-environment jsdom
import React, {useState} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {CollectionStage} from "../../components/collection-stage";
import {MusicLibrary, useMusicLibrary} from "../../components/music-library";
import type {Asset, Entry} from "../../lib/types";

vi.mock("../../components/motion", () => ({
  useMotionPreference: () => false,
  MotionSwap: ({children}: {children: React.ReactNode}) => children,
  MotionPresence: ({show, children}: {show: boolean; children: React.ReactNode}) => show ? children : null,
}));
vi.mock("next/navigation", () => ({usePathname: () => "/app/music"}));
const entries: Entry[] = Array.from({length: 8}, (_, index) => ({
  id: `song-${index}`, ownerId: "test-owner", kind: "music", title: `验收歌曲 ${index}`,
  data: [1, 7].includes(index) ? {assetId: `audio-${index}`} : {},
  favorite: false, createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
}));
const assets: Asset[] = [1, 7].map(index => ({id: `audio-${index}`, ownerId: "test-owner", filename: `tone-${index}.wav`, mimeType: "audio/wav", size: 100, mediaType: "audio", storagePath: `test/tone-${index}.wav`, rightsStatus: "personal_only", allowedUseScope: ["private_storage", "private_playback"], createdAt: entries[0].createdAt}));
function Harness({initiallyVisible = true, onAddAudio}: {initiallyVisible?: boolean; onAddAudio?: (entry: Entry) => void}) {
  const music = useMusicLibrary();
  const [visible, setVisible] = useState(initiallyVisible);
  if (!music) throw new Error("Missing real music provider");
  return React.createElement(React.Fragment, null,
    React.createElement("button", {onClick: () => music.select("song-7", true)}, "列表播放第八首"),
    React.createElement("button", {onClick: () => music.select("song-6", true)}, "列表选择无音源"),
    React.createElement("button", {onClick: () => music.select("song-1", true)}, "列表播放第一首"),
    React.createElement("button", {onClick: () => music.play("song-1")}, "重新播放第一首"),
    React.createElement("button", {onClick: () => music.move(1)}, "全局切换下一首"),
    React.createElement("button", {onClick: () => setVisible(true)}, "显示唱片台"),
    visible ? React.createElement(CollectionStage, {kind: "music", entries, assets, onOpen: vi.fn(), onAddAudio}) : null,
  );
}
function mount(initiallyVisible = true, onAddAudio?: (entry: Entry) => void) {
  return render(React.createElement(MusicLibrary, {initialEntries: entries, initialAssets: assets} as React.ComponentProps<typeof MusicLibrary>, React.createElement(Harness, {initiallyVisible, onAddAudio})));
}
function stage() { return screen.getByRole("region", {name: "星轨唱片台"}); }
function selected() { return (within(stage()).getByLabelText("唱片台选曲") as HTMLSelectElement).value; }
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function(this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", {configurable: true, value: false});
    this.dispatchEvent(new Event("play", {bubbles: true}));
    this.dispatchEvent(new Event("playing", {bubbles: true}));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function(this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", {configurable: true, value: true});
    this.dispatchEvent(new Event("pause", {bubbles: true}));
  });
});
afterEach(() => {cleanup(); vi.restoreAllMocks();});

describe("vinyl and list share one music selection", () => {
  it("opens on the existing audio selection and follows external metadata selections beyond item six", () => {
    const add = vi.fn();
    mount(false, add);
    fireEvent.click(screen.getByRole("button", {name: "列表播放第八首"}));
    fireEvent.click(screen.getByRole("button", {name: "显示唱片台"}));
    expect(selected()).toBe("song-7");
    expect(within(stage()).getByRole("heading", {level: 2}).textContent).toBe(entries[7].title);
    expect(within(stage()).getAllByRole("option")).toHaveLength(8);
    expect(stage().getAttribute("data-playing")).toBe("true");
    fireEvent.click(screen.getByRole("button", {name: "列表选择无音源"}));
    expect(selected()).toBe("song-6");
    expect(stage().getAttribute("data-playing")).toBe("false");
    expect((screen.getByTestId("global-audio") as HTMLAudioElement).paused).toBe(true);
    fireEvent.click(within(stage()).getByRole("button", {name: /^添加音频$/}));
    expect(add).toHaveBeenCalledWith(entries[6]);
  });

  it("reselects the same underlying audio after browsing another song, through both list and play APIs", () => {
    mount();
    fireEvent.click(screen.getByRole("button", {name: "列表播放第一首"}));
    expect(selected()).toBe("song-1");
    fireEvent.change(within(stage()).getByLabelText("唱片台选曲"), {target: {value: "song-6"}});
    expect(selected()).toBe("song-6");
    expect(stage().getAttribute("data-playing")).toBe("false");
    fireEvent.click(screen.getByRole("button", {name: "列表播放第一首"}));
    expect(selected()).toBe("song-1");
    expect(stage().getAttribute("data-playing")).toBe("true");
    fireEvent.change(within(stage()).getByLabelText("唱片台选曲"), {target: {value: "song-6"}});
    fireEvent.click(screen.getByRole("button", {name: "重新播放第一首"}));
    expect(selected()).toBe("song-1");
    expect(within(stage()).getByRole("heading", {level: 2}).textContent).toBe(entries[1].title);
    expect(stage().getAttribute("data-playing")).toBe("true");
    expect(screen.getAllByTestId("global-audio")).toHaveLength(1);
  });

  it("skips metadata-only songs while listening and follows global next on the same selection", () => {
    mount();
    fireEvent.click(screen.getByRole("button", {name: "列表播放第一首"}));
    fireEvent.click(within(stage()).getByRole("button", {name: "下一首唱片"}));
    expect(selected()).toBe("song-7");
    expect(stage().getAttribute("data-playing")).toBe("true");
    fireEvent.click(screen.getByRole("button", {name: "全局切换下一首"}));
    expect(selected()).toBe("song-1");
    expect(within(stage()).getByRole("heading", {level: 2}).textContent).toBe(entries[1].title);
  });

  it("keeps the needle on the groove while buffering and parks it on pause, missing audio or error", () => {
    mount();
    const armState = () => stage().querySelector(".collection-tonearm-assembly")?.getAttribute("data-arm-state");
    expect(armState()).toBe("parked");
    fireEvent.click(screen.getByRole("button", {name: "列表播放第一首"}));
    expect(armState()).toBe("engaged");
    const audio = screen.getByTestId("global-audio");
    fireEvent.waiting(audio);
    expect(stage().getAttribute("data-playing")).toBe("false");
    expect(armState()).toBe("engaged");
    expect(within(stage()).getByRole("status").textContent).toContain("正在缓冲");
    fireEvent.click(within(stage()).getByRole("button", {name: "唱片台暂停验收歌曲 1"}));
    expect(armState()).toBe("parked");
    expect(within(stage()).getByRole("status").textContent).toContain("已暂停");
    fireEvent.click(screen.getByRole("button", {name: "列表播放第一首"}));
    fireEvent.error(audio);
    expect(armState()).toBe("parked");
    expect(stage().getAttribute("data-playing")).toBe("false");
    expect(within(stage()).getByRole("status").textContent).toContain("播放遇到问题");
    fireEvent.click(screen.getByRole("button", {name: "列表选择无音源"}));
    expect(armState()).toBe("parked");
    expect(within(stage()).getByRole("status").textContent).toContain("等待你的音频");
  });

  it("labels the end of a single record and parks the needle instead of calling it paused", () => {
    render(React.createElement(MusicLibrary, {initialEntries: [entries[1]], initialAssets: [assets[0]]} as React.ComponentProps<typeof MusicLibrary>, React.createElement(CollectionStage, {kind: "music", entries: [entries[1]], assets: [assets[0]], onOpen: vi.fn()})));
    fireEvent.click(within(stage()).getByRole("button", {name: "唱片台播放验收歌曲 1"}));
    const audio = screen.getByTestId("global-audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", {configurable: true, value: 120});
    fireEvent.loadedMetadata(audio);
    audio.currentTime = 120;
    fireEvent.timeUpdate(audio);
    fireEvent.ended(audio);
    expect(within(stage()).getByRole("status").textContent).toContain("播放结束");
    expect(within(stage()).getByRole("button", {name: "唱片台播放验收歌曲 1"}).textContent).toContain("重新播放");
    expect(stage().querySelector(".collection-tonearm-assembly")?.getAttribute("data-arm-state")).toBe("parked");
  });
});
