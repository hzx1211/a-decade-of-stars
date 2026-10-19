// @vitest-environment jsdom
import React from "react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {MusicLibrary, useMusicLibrary} from "../../components/music-library";
import {MotionScope} from "../../components/motion";
import type {Asset, Entry} from "../../lib/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const entries: Entry[] = ["first", "second"].map(id => ({
  id, ownerId: "test-owner", kind: "music", title: `合成验收曲目 ${id}`, favorite: false,
  createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z",
  data: {assetId: `asset-${id}`},
}));
const assets: Asset[] = entries.map(entry => ({
  id: entry.data.assetId!, ownerId: "test-owner", filename: `${entry.id}.wav`, mimeType: "audio/wav",
  size: 128, mediaType: "audio", storagePath: `test/${entry.id}.wav`, rightsStatus: "personal_only",
  allowedUseScope: ["private_storage", "private_playback"], createdAt: entry.createdAt,
}));
function PlaybackProbe() {
  const music = useMusicLibrary();
  if (!music) throw new Error("Music library provider is missing");
  return React.createElement(React.Fragment, null,
    React.createElement("output", {"data-testid": "playback-state"}, JSON.stringify({
      current: music.current?.entry.id, playing: music.playing, loading: music.loading,
      duration: music.duration, error: music.error,
    })),
    ...entries.map(entry => React.createElement("button", {key: entry.id, onClick: () => music.play(entry.id)}, `播放 ${entry.id}`)),
    React.createElement("button", {onClick: music.pause}, "暂停验收"),
  );
}
function mountPlayback(initialAssets: Asset[] = assets) {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function(this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", {configurable: true, value: true});
    this.dispatchEvent(new Event("pause", {bubbles: true}));
  });
  render(React.createElement(MotionScope, {enabled: false} as React.ComponentProps<typeof MotionScope>,
    React.createElement(MusicLibrary, {initialEntries: entries, initialAssets} as React.ComponentProps<typeof MusicLibrary>,
      React.createElement(PlaybackProbe),
    ),
  ));
  return screen.getByTestId("global-audio") as HTMLAudioElement;
}
function playbackState() { return JSON.parse(screen.getByTestId("playback-state").textContent || "{}"); }

describe("persistent music player request lifecycle", () => {
  it("plays an existing private song without provenance metadata or scope flags", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const audio = mountPlayback(assets.map(asset => ({...asset, rightsStatus: "unknown", allowedUseScope: []})));
    await act(async () => { fireEvent.click(screen.getByRole("button", {name: "播放 first"})); });
    fireEvent.playing(audio);
    expect(audio.getAttribute("src")).toBe("/api/assets/asset-first");
    expect(playbackState()).toMatchObject({current: "first", playing: true, error: ""});
  });

  it("ignores a former song's delayed playback failure after another song starts", async () => {
    let rejectFirst!: (reason: Error) => void;
    vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValue(undefined);
    const audio = mountPlayback();
    fireEvent.click(screen.getByRole("button", {name: "播放 first"}));
    fireEvent.click(screen.getByRole("button", {name: "播放 second"}));
    fireEvent.playing(audio);
    await act(async () => { rejectFirst(new Error("First source failed after the source changed")); });
    expect(playbackState()).toMatchObject({current: "second", playing: true, loading: false, error: ""});
    expect(screen.getAllByTestId("global-audio")).toHaveLength(1);
  });

  it("does not show a delayed playback failure after the user has paused", async () => {
    let rejectPlay!: (reason: Error) => void;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectPlay = reject; }));
    mountPlayback();
    fireEvent.click(screen.getByRole("button", {name: "播放 first"}));
    fireEvent.click(screen.getByRole("button", {name: "暂停验收"}));
    await act(async () => { rejectPlay(new Error("Playback was cancelled")); });
    expect(playbackState()).toMatchObject({current: "first", playing: false, loading: false, error: ""});
  });

  it("cancels an initial pending play request even while the media element is still paused", async () => {
    let resolvePlay!: () => void;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementationOnce(() => new Promise<void>(resolve => { resolvePlay = resolve; }));
    const audio = mountPlayback();
    fireEvent.click(screen.getByRole("button", {name: "播放 first"}));
    expect(audio.paused).toBe(true);
    expect(playbackState()).toMatchObject({loading: true, playing: false});
    fireEvent.click(screen.getByRole("button", {name: "暂停音乐"}));
    expect(play).toHaveBeenCalledTimes(1);
    expect(playbackState()).toMatchObject({loading: false, playing: false, error: ""});
    await act(async () => { resolvePlay(); });
    expect(playbackState()).toMatchObject({loading: false, playing: false, error: ""});
    expect(screen.getByRole("button", {name: "播放音乐"}).getAttribute("aria-busy")).toBe("false");
  });

  it("clears the prior playing state when starting the next song fails", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Unsupported second source"));
    const audio = mountPlayback();
    fireEvent.click(screen.getByRole("button", {name: "播放 first"}));
    fireEvent.playing(audio);
    expect(playbackState().playing).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", {name: "播放 second"})); });
    expect(playbackState()).toMatchObject({current: "second", playing: false, loading: false});
    expect(playbackState().error).toContain("未能开始播放");
  });

  it("updates a duration discovered after metadata without falsely finishing buffering", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const audio = mountPlayback();
    fireEvent.click(screen.getByRole("button", {name: "播放 first"}));
    Object.defineProperty(audio, "duration", {configurable: true, value: Infinity});
    fireEvent.loadedMetadata(audio);
    expect(playbackState()).toMatchObject({duration: 0, loading: true});
    expect((screen.getByRole("slider", {name: "播放进度"}) as HTMLInputElement).disabled).toBe(true);
    Object.defineProperty(audio, "duration", {configurable: true, value: 91.5});
    fireEvent.durationChange(audio);
    expect(playbackState()).toMatchObject({duration: 91.5, loading: true});
    expect((screen.getByRole("slider", {name: "播放进度"}) as HTMLInputElement).max).toBe("91.5");
    expect((screen.getByRole("slider", {name: "播放进度"}) as HTMLInputElement).disabled).toBe(false);
    fireEvent.playing(audio);
    expect(playbackState()).toMatchObject({playing: true, loading: false});
  });
});

describe("persistent music player buffering controls", () => {
  it("clears loading when paused during buffering and can resume on the same audio element", () => {
    const entry: Entry = {
      id: "track-1", ownerId: "owner", kind: "music", title: "测试曲目", favorite: false,
      createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
      data: {assetId: "asset-1", artist: "测试艺术家"},
    };
    const asset: Asset = {
      id: "asset-1", ownerId: "owner", filename: "track.wav", mimeType: "audio/wav", size: 128,
      mediaType: "audio", storagePath: "owner/track.wav", rightsStatus: "personal_only",
      allowedUseScope: ["private_storage", "private_playback"], createdAt: entry.createdAt,
    };
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function(this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", {configurable: true, value: false});
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function(this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", {configurable: true, value: true});
      this.dispatchEvent(new Event("pause", {bubbles: true}));
    });
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);

    function StateProbe() {
      const music = useMusicLibrary();
      if (!music) throw new Error("Music library provider is missing");
      return React.createElement(React.Fragment, null,
        React.createElement("output", {
          "data-testid": "player-state",
          "data-loading": String(music.loading),
          "data-playing": String(music.playing),
        }),
        React.createElement("button", {onClick: () => music.play(entry.id)}, "开始测试曲目"),
      );
    }

    render(React.createElement(MotionScope, {enabled: false} as React.ComponentProps<typeof MotionScope>,
      React.createElement(MusicLibrary, {initialEntries: [entry], initialAssets: [asset]} as React.ComponentProps<typeof MusicLibrary>,
        React.createElement(StateProbe),
      ),
    ));

    const audio = screen.getByTestId("global-audio") as HTMLAudioElement;
    fireEvent.click(screen.getByRole("button", {name: "开始测试曲目"}));
    fireEvent.waiting(audio);
    expect(screen.getByTestId("player-state").getAttribute("data-loading")).toBe("true");

    // Pause while the media element is still waiting for data.
    fireEvent.click(screen.getByRole("button", {name: "暂停音乐"}));
    expect(audio.paused).toBe(true);
    expect(screen.getByTestId("player-state").getAttribute("data-loading")).toBe("false");
    expect(screen.getByTestId("player-state").getAttribute("data-playing")).toBe("false");
    expect(screen.getByRole("button", {name: "播放音乐"}).getAttribute("aria-busy")).toBe("false");

    fireEvent.click(screen.getByRole("button", {name: "播放音乐"}));
    fireEvent.playing(audio);
    expect(play).toHaveBeenCalledTimes(2);
    expect(audio.paused).toBe(false);
    expect(screen.getByTestId("player-state").getAttribute("data-playing")).toBe("true");
    expect(screen.getAllByTestId("global-audio")).toHaveLength(1);
  });
});
