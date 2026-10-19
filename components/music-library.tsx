"use client";

import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import type {Asset, Entry} from "@/lib/types";
import {parseNeteaseMusic} from "@/lib/netease";
import {MusicDock} from "./music-dock";
import {LyricsPlayer} from "./lyrics-player";
import {NeteasePlayer} from "./netease-player";
import {request} from "./client-utils";
import "./music-library.css";

type Track = {entry: Entry; asset: Asset; cover?: Asset};
type ExternalTrack = {entry: Entry; url: string; embedUrl: string};
export type MusicState = {
  tracks: Track[]; current?: Track; selectedId: string; playing: boolean; loading: boolean;
  time: number; duration: number; volume: number; error: string;
  select: (id: string, autoplay?: boolean) => void;
  play: (id: string) => void; pause: () => void; toggle: () => void;
  seek: (value: number) => void; setVolume: (value: number) => void; move: (direction: number) => void;
  updateLibrary: (entries: Entry[], assets: Asset[]) => void;
  openLyrics: (id?: string) => void;
  externalTracks?: ExternalTrack[];
  externalCurrent?: ExternalTrack;
};
export const musicEntryUpdatedEvent = "archive:music-entry-updated";
const Music = createContext<MusicState | null>(null);
export function useMusicLibrary() { return useContext(Music); }

export function MusicLibrary({children, initialEntries = [], initialAssets = []}: {children: ReactNode; initialEntries?: Entry[]; initialAssets?: Asset[]}) {
  const [library, setLibrary] = useState({entries: initialEntries, assets: initialAssets});
  const [currentId, setCurrentId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [lyricsEntryId, setLyricsEntryId] = useState<string | null>(null);
  const [externalEntryId, setExternalEntryId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false), [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0), [duration, setDuration] = useState(0), [volume, updateVolume] = useState(.7), [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const playRequest = useRef(0);
  const restoreLyricsFocus = useRef(false);
  const tracks = useMemo(() => library.entries.flatMap(entry => {
    if (entry.data.sourceType === "official_embed" && parseNeteaseMusic(entry.data.externalUrl || "")) return [];
    const asset = library.assets.find(item => item.id === entry.data.assetId);
    return entry.kind === "music" && asset?.mediaType === "audio"
      ? [{entry, asset, cover: library.assets.find(item => item.id === entry.data.coverAssetId && item.mediaType === "image")}] : [];
  }), [library]);
  const externalTracks = useMemo<ExternalTrack[]>(() => library.entries.flatMap(entry => {
    if (entry.kind !== "music" || tracks.some(track => track.entry.id === entry.id)) return [];
    const source = parseNeteaseMusic(entry.data.externalUrl || "");
    return source ? [{entry, url: source.url, embedUrl: source.embedUrl}] : [];
  }), [library, tracks]);
  const externalCurrent = externalTracks.find(track => track.entry.id === externalEntryId);
  const current = tracks.find(track => track.entry.id === currentId);
  const lyricsEntry = library.entries.find(entry => entry.id === lyricsEntryId && entry.kind === "music");
  const updateLibrary = useCallback((entries: Entry[], assets: Asset[]) => setLibrary({entries, assets}), []);

  function play(id: string) {
    const external = externalTracks.find(track => track.entry.id === id);
    if (external) {
      close();
      setSelectedId(id); setLyricsEntryId(null); setExternalEntryId(id);
      // Official frames cannot share a playback clock with the local audio element.
      for (const player of document.querySelectorAll<HTMLMediaElement>("audio,video")) player.pause();
      return;
    }
    const track = tracks.find(item => item.entry.id === id), element = audio.current;
    if (!track || !element) return;
    setExternalEntryId(null);
    const request = ++playRequest.current;
    setSelectedId(id);
    setLyricsEntryId(previous => previous === null ? null : id);
    setError("");
    if (currentId !== id || element.getAttribute("src") !== `/api/assets/${track.asset.id}`) {
      element.src = `/api/assets/${track.asset.id}`; element.load();
      setTime(0); setDuration(0); setLoading(true); setCurrentId(id);
    }
    element.volume = volume;
    void element.play().catch(failure => {
      // A previous song may finish rejecting after a new song starts or the user pauses.
      if (request !== playRequest.current) return;
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      setPlaying(false); setLoading(false); setError("未能开始播放，请再点一次播放，或检查音频格式。");
    });
  }
  function pause() { ++playRequest.current; audio.current?.pause(); setPlaying(false); setLoading(false); }
  function select(id: string, autoplay = false) {
    if (!library.entries.some(entry => entry.id === id && entry.kind === "music")) return;
    setSelectedId(id);
    const playable = tracks.some(track => track.entry.id === id) || externalTracks.some(track => track.entry.id === id);
    if (externalEntryId && externalEntryId !== id) setExternalEntryId(null);
    if (autoplay && playable) play(id);
    else if (currentId !== id || !playable) pause();
  }
  function toggle() { if (!audio.current || !current) return; if (loading || !audio.current.paused) pause(); else play(current.entry.id); }
  function move(direction: number) { if (tracks.length < 2) return; const index = tracks.findIndex(track => track.entry.id === currentId); play(tracks[(index + direction + tracks.length) % tracks.length].entry.id); }
  function close() { pause(); audio.current?.removeAttribute("src"); audio.current?.load(); setCurrentId(""); setExternalEntryId(null); setTime(0); setDuration(0); setError(""); }
  function seek(value: number) {
    const element = audio.current;
    if (!element || !Number.isFinite(value) || !Number.isFinite(element.duration)) return;
    const next = Math.max(0, Math.min(value, element.duration));
    element.currentTime = next; setTime(next);
  }
  function setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    const next = Math.max(0, Math.min(value, 1));
    updateVolume(next); if (audio.current) audio.current.volume = next;
  }
  useEffect(() => {
    const element = audio.current;
    if (currentId && !current && element) { ++playRequest.current; element.pause(); element.removeAttribute("src"); element.load(); }
  }, [currentId, current]);
  function openLyrics(id = currentId || selectedId) {
    if (externalTracks.some(track => track.entry.id === id)) { play(id); return; }
    if (library.entries.some(entry => entry.id === id && entry.kind === "music")) setLyricsEntryId(id);
  }
  function closeLyrics() {
    restoreLyricsFocus.current = true;
    setLyricsEntryId(null);
  }
  useEffect(() => {
    if (lyricsEntryId !== null || !restoreLyricsFocus.current) return;
    restoreLyricsFocus.current = false;
    // Wait for the dialog cleanup before restoring an opener the dock may have removed.
    const frame = requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      const fallback = document.querySelector<HTMLElement>(".music-dock-handle") || document.querySelector<HTMLElement>(".lyrics-open-button, .music-dock-lyrics");
      fallback?.focus({preventScroll: true});
    });
    return () => cancelAnimationFrame(frame);
  }, [lyricsEntryId]);
  async function saveLyrics(id: string, lyrics: string, lyricsOffset: number) {
    // PATCH replaces data; read the latest record so a lyrics edit keeps its audio and metadata.
    const latest = await request<{entry: Entry}>(`/api/entries/${id}`);
    const result = await request<{entry: Entry}>(`/api/entries/${id}`, {method: "PATCH", body: JSON.stringify({data: {...latest.entry.data, lyrics, lyricsOffset}})});
    setLibrary(previous => ({...previous, entries: previous.entries.map(entry => entry.id === id ? result.entry : entry)}));
    window.dispatchEvent(new CustomEvent<Entry>(musicEntryUpdatedEvent, {detail: result.entry}));
    return result.entry;
  }
  const music: MusicState = {tracks, current, selectedId, playing, loading, time, duration, volume, error, select, play, pause, toggle, seek, setVolume, move, updateLibrary, openLyrics, externalTracks, externalCurrent};
  return <Music.Provider value={music}>
    {children}
    <audio ref={audio} data-testid="global-audio" preload="metadata" onPlay={event => { for (const player of document.querySelectorAll<HTMLMediaElement>("audio,video")) if (player !== event.currentTarget) player.pause(); }} onPause={() => {setPlaying(false); setLoading(false);}} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onDurationChange={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onCanPlay={() => setLoading(false)} onWaiting={() => setLoading(true)} onPlaying={() => {setLoading(false); setPlaying(true);}} onEnded={() => {setPlaying(false); setLoading(false); if (tracks.length > 1) move(1);}} onError={() => {setPlaying(false); setLoading(false); setError("音频读取失败，请检查文件或换用 MP3、WAV、OGG。");}} />
    <MusicDock music={music} onClose={close} />
    {lyricsEntry && <LyricsPlayer entry={lyricsEntry} cover={library.assets.find(asset => asset.id === lyricsEntry.data.coverAssetId && asset.mediaType === "image")} music={music} onSave={saveLyrics} onClose={closeLyrics} />}
    {externalCurrent && <NeteasePlayer key={externalCurrent.entry.id} {...externalCurrent} onClose={() => setExternalEntryId(null)} />}
  </Music.Provider>;
}
