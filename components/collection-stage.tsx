"use client";

import {useEffect, useId, useState, type CSSProperties} from "react";
import {ArrowUpRight, ChevronLeft, ChevronRight, ListMusic, LoaderCircle, Play, Pause, Upload, Volume2} from "lucide-react";
import {motion} from "motion/react";
import type {Asset, Entry} from "@/lib/types";
import {VMark} from "./v-mark";
import {MotionPresence, MotionSwap, useMotionPreference} from "./motion";
import {GlassLayers} from "./liquid-glass-effects";
import {useMusicLibrary} from "./music-library";
import "./collection-player.css";

type StageProps = {kind: string; entries: Entry[]; assets: Asset[]; onOpen: (entry: Entry) => void; onAddAudio?: (entry: Entry) => void};
const ease = [.22, 1, .36, 1] as const;
function clock(value: number) { const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

/** The arm and record share a 360 x 340 coordinate system at every viewport size. */
function Tonearm({engaged, progress}: {engaged: boolean; progress: number}) {
  const id = useId();
  const angle = engaged ? 22 + Math.min(100, Math.max(0, progress)) * .11 : -3;
  return <svg className="collection-tonearm-assembly" viewBox="0 0 360 340" aria-hidden="true" focusable="false" data-arm-state={engaged ? "engaged" : "parked"}>
    <defs>
      <linearGradient id={`${id}-metal`} gradientUnits="userSpaceOnUse" x1="-10" y1="0" x2="10" y2="0"><stop offset="0" stopColor="#64809d" /><stop offset=".35" stopColor="#f2f7fc" /><stop offset=".6" stopColor="#b4c9dc" /><stop offset="1" stopColor="#526d89" /></linearGradient>
      <radialGradient id={`${id}-bearing`}><stop stopColor="#c0d8ed" /><stop offset=".35" stopColor="#3c5b7a" /><stop offset=".7" stopColor="#10263e" /><stop offset="1" stopColor="#88a6c2" /></radialGradient>
    </defs>
    <rect className="collection-arm-rest" x="308" y="222" width="21" height="27" rx="7" fill="#0a1b30" stroke="#829eb9" strokeWidth="1.5" />
    <path d="M313 228v8h11v-8" fill="none" stroke="#aac2d8" strokeWidth="2" strokeLinecap="round" />
    <circle cx="309" cy="54" r="19" fill="#09192d" stroke="#6887a7" strokeWidth="1" />
    <circle cx="309" cy="54" r="14" fill={`url(#${id}-bearing)`} />
    <g transform="translate(309 54)">
      <g className="collection-tonearm" style={{"--arm-angle": `${angle}deg`} as CSSProperties}>
        <rect x="-10" y="-26" width="20" height="21" rx="4" fill={`url(#${id}-metal)`} stroke="#68839e" />
        <path d="M0 -5V155" stroke="#03101f" strokeOpacity=".6" strokeWidth="9" strokeLinecap="round" transform="translate(2 3)" />
        <path d="M0 -5V155" stroke={`url(#${id}-metal)`} strokeWidth="5" strokeLinecap="round" />
        <path d="M-1 -5V149" stroke="#f0f7ff" strokeOpacity=".65" strokeWidth="1" strokeLinecap="round" />
        <rect x="-7" y="149" width="14" height="27" rx="3" fill={`url(#${id}-metal)`} stroke="#5c7b99" />
        <path d="M-3 155h6M-3 159h6" stroke="#4f6c87" strokeWidth="1" />
        <path d="M0 176v5" stroke="#dcecff" strokeWidth="2" />
        <circle className="collection-stylus-tip" cx="0" cy="181" r="2" fill="#c6eaff" />
      </g>
    </g>
    <circle cx="309" cy="54" r="6" fill={`url(#${id}-bearing)`} stroke="#c1d7e9" strokeWidth="1" />
    <path d="m306 54 6 0" stroke="#153450" strokeWidth="1.5" />
  </svg>;
}

export function CollectionStage(props: StageProps) {
  if (props.kind === "music") return <VinylPlayer {...props} />;
  if (props.kind === "albums") return <AlbumExplorer {...props} />;
  return null;
}

/** A second control surface for the one global audio element, rather than a second player. */
function VinylPlayer({entries, assets, onOpen, onAddAudio}: StageProps) {
  const animated = useMotionPreference();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Enable native controls only after hydration and the initial effects have committed.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Mount readiness must differ from the server render.
    setReady(true);
  }, []);
  const music = useMusicLibrary();
  const globalId = music?.current?.entry.id || "";
  // List, turntable and global playback all read the same selection, including metadata-only songs.
  const selectedId = [music?.selectedId, globalId].find(id => entries.some(entry => entry.id === id)) || entries[0]?.id;
  const index = Math.max(0, entries.findIndex(entry => entry.id === selectedId));
  const current = entries[index];
  if (!current) return null;
  const playableIds = new Set([...(music?.tracks.map(track => track.entry.id) || []), ...(music?.externalTracks?.map(track => track.entry.id) || [])]);
  const external = music?.externalTracks?.find(track => track.entry.id === current.id);
  const playable = playableIds.has(current.id);
  const selectedIsCurrent = globalId === current.id;
  const active = selectedIsCurrent && !!music?.playing;
  const loading = selectedIsCurrent && !!music?.loading;
  const error = selectedIsCurrent ? music?.error || "" : "";
  const spinning = active && !loading && !error;
  const canStep = entries.length > 1 && (!(active || loading) || entries.filter(entry => playableIds.has(entry.id)).length > 1);
  const cover = assets.find(asset => asset.id === current.data.coverAssetId && asset.mediaType === "image");
  const time = selectedIsCurrent ? music?.time || 0 : 0;
  const duration = selectedIsCurrent ? music?.duration || 0 : 0;
  const volume = music?.volume ?? .7;
  const seekPercent = duration > 0 ? Math.min(100, Math.max(0, time / duration * 100)) : 0;
  const armEngaged = selectedIsCurrent && (active || loading) && !error;
  const ended = selectedIsCurrent && !active && !loading && duration > 0 && time >= duration - .05;
  const status = external ? "网易云官方播放器" : !playable ? "等待你的音频" : error ? "播放遇到问题" : loading ? active ? "正在缓冲" : "正在载入音频" : active ? "正在播放" : ended ? "播放结束" : selectedIsCurrent ? "已暂停" : "可以播放";
  const addAudio = () => (onAddAudio || onOpen)(current);

  function choose(entry: Entry) {
    const shouldContinue = selectedIsCurrent && !!(music?.playing || music?.loading);
    music?.select(entry.id, shouldContinue);
  }
  function move(direction: number) {
    if (entries.length < 2) return;
    // During playback skip missing audio; the selector can still browse every song.
    if (selectedIsCurrent && (music?.playing || music?.loading)) {
      for (let distance = 1; distance < entries.length; distance++) {
        const next = entries[(index + direction * distance + entries.length * 2) % entries.length];
        if (playableIds.has(next.id)) { choose(next); return; }
      }
      return;
    }
    choose(entries[(index + direction + entries.length) % entries.length]);
  }
  function toggle() {
    if (!playable) { addAudio(); return; }
    if (selectedIsCurrent && (music?.playing || music?.loading)) music?.pause();
    else music?.play(current.id);
  }

  const action = loading ? <LoaderCircle size={20} className="ws-spin" /> : active ? <Pause size={20} fill="currentColor" /> : playable ? <Play size={20} fill="currentColor" /> : <Upload size={20} />;
  return <motion.section className={`collection-stage collection-stage-music collection-player ${animated ? "has-ambient-motion" : ""}`} aria-label="星轨唱片台" data-playing={spinning} data-motion-managed initial={animated ? {opacity: 0, y: 20} : false} animate={{opacity: 1, y: 0}} transition={{duration: animated ? .65 : 0, ease}}>
    <div className="collection-stage-art">
      <span className="collection-orbit collection-orbit-one" aria-hidden="true" /><span className="collection-orbit collection-orbit-two" aria-hidden="true" />
      <div className="collection-turntable">
        <button type="button" className="collection-vinyl-button" disabled={!ready} aria-label={!playable ? `为${current.title}添加音频` : `${active || loading ? "暂停" : "播放"}唱片 ${current.title}`} aria-busy={loading} onClick={toggle}>
          <span className="collection-record" aria-hidden="true"><span className="collection-record-grooves" /><span className="collection-record-label">{cover ? <img src={`/api/assets/${cover.id}`} alt="" /> : <VMark size={68} />}</span><span className="collection-record-spindle" /></span>
          <span className="collection-vinyl-action" aria-hidden="true">{action}</span>
        </button>
        <Tonearm engaged={armEngaged} progress={seekPercent} />
      </div>
      <span className="collection-stage-coordinate" aria-hidden="true">BLUE STAR SEA<i />{String(index + 1).padStart(2, "0")}</span>
    </div>
    <div className="collection-stage-copy">
      <div className="collection-player-heading"><p className="collection-stage-kicker"><span />星轨唱片台</p><span className="collection-player-status" role="status"><i />{status}</span></div>
      <MotionSwap motionKey={current.id} className="collection-current"><span className="collection-stage-year">{current.data.year || current.data.date?.slice(0, 4) || "PRIVATE COLLECTION"}</span><h2>{current.title}</h2><p>{current.data.artist || "私人音乐收藏"}</p></MotionSwap>
      {external ? <div className="collection-external-controls"><div className="collection-transport"><button type="button" className="collection-step" aria-label="上一首唱片" disabled={!ready || !canStep} onClick={() => move(-1)}><ChevronLeft size={20} /></button><button type="button" className="collection-primary-action" disabled={!ready} aria-label={`唱片台播放${current.title}`} onClick={() => music?.play(current.id)}><Play size={20} fill="currentColor" /><span>网易云播放</span></button><button type="button" className="collection-step" aria-label="下一首唱片" disabled={!ready || !canStep} onClick={() => move(1)}><ChevronRight size={20} /></button></div><button type="button" className="collection-song-details" onClick={() => onOpen(current)}>歌曲资料<ArrowUpRight size={13} /></button></div> : playable ? <div className="collection-audio-controls">
        <div className="collection-transport"><button type="button" className="collection-step" aria-label="上一首唱片" disabled={!ready || !canStep} onClick={() => move(-1)}><ChevronLeft size={20} /></button><button type="button" className="collection-primary-action" disabled={!ready} aria-label={`唱片台${active || loading ? "暂停" : "播放"}${current.title}`} aria-busy={loading} onClick={toggle}>{action}<span>{loading ? "取消载入" : active ? "暂停播放" : ended ? "重新播放" : "开始播放"}</span></button><button type="button" className="collection-step" aria-label="下一首唱片" disabled={!ready || !canStep} onClick={() => move(1)}><ChevronRight size={20} /></button></div>
        <label className="collection-progress"><input aria-label="唱片台播放进度" aria-valuetext={`${clock(time)} / ${clock(duration)}`} type="range" min="0" max={duration || 1} step="0.1" value={Math.min(time, duration || 1)} disabled={!duration || !selectedIsCurrent} style={{"--range-fill": `${seekPercent}%`} as CSSProperties} onChange={event => music?.seek(Number(event.target.value))} /><span><time>{clock(time)}</time><time>{clock(duration)}</time></span></label>
        <div className="collection-volume-row"><Volume2 size={15} aria-hidden="true" /><input aria-label="唱片台音量" aria-valuetext={`${Math.round(volume * 100)}%`} type="range" min="0" max="1" step="0.01" value={volume} style={{"--range-fill": `${volume * 100}%`} as CSSProperties} onChange={event => music?.setVolume(Number(event.target.value))} /><span>{Math.round(volume * 100)}%</span><button type="button" className="collection-song-details" onClick={() => onOpen(current)}>歌曲资料<ArrowUpRight size={13} /></button></div>
      </div> : <div className="collection-audio-empty"><p>添加音频，让唱片转起来</p><button type="button" className="collection-primary-action" onClick={addAudio}><Upload size={17} />添加音频</button><button type="button" className="collection-song-details" onClick={() => onOpen(current)}>歌曲资料<ArrowUpRight size={13} /></button></div>}
      <MotionPresence show={!!error} className="collection-playback-error"><p role="alert">{error}</p></MotionPresence>
      {!external && <button type="button" className="lyrics-open-button" disabled={!ready} onClick={() => music?.openLyrics(current.id)}><ListMusic size={18} />歌词<span>{current.data.lyrics?.trim() ? "跟着旋律，一起唱" : "添加歌词"}</span><ArrowUpRight size={15} /></button>}
      <div className="collection-player-library"><label><span>选一首歌</span><select disabled={!ready} aria-label="唱片台选曲" value={current.id} onChange={event => {const entry = entries.find(item => item.id === event.target.value); if (entry) choose(entry);}}>{entries.map((entry, entryIndex) => <option value={entry.id} key={entry.id}>{String(entryIndex + 1).padStart(2, "0")} · {entry.title}{playableIds.has(entry.id) ? "" : " · 待添加音频"}</option>)}</select></label><span className="collection-library-count">{String(index + 1).padStart(2, "0")}<small> / {String(entries.length).padStart(2, "0")}</small></span></div>
      {!playable && <div className="collection-browse-empty"><button type="button" aria-label="上一首唱片" disabled={entries.length < 2} onClick={() => move(-1)}><ChevronLeft size={16} />上一首</button><button type="button" aria-label="下一首唱片" disabled={entries.length < 2} onClick={() => move(1)}>下一首<ChevronRight size={16} /></button></div>}
    </div>
    <GlassLayers />
  </motion.section>;
}

function AlbumExplorer({entries, onOpen}: StageProps) {
  const [selection, setSelection] = useState(0);
  const animated = useMotionPreference();
  const items = entries.slice(0, 6);
  const index = Math.min(selection, Math.max(0, items.length - 1));
  const current = items[index];
  if (!current) return null;
  const move = (direction: number) => setSelection((index + direction + items.length) % items.length);
  return <motion.section className={`collection-stage collection-stage-albums ${animated ? "has-ambient-motion" : ""}`} aria-label="专辑漫游" data-motion-managed initial={animated ? {opacity: 0, y: 20} : false} animate={{opacity: 1, y: 0}} transition={{duration: animated ? .65 : 0}}>
    <div className="collection-stage-art" aria-hidden="true"><span className="collection-orbit collection-orbit-one" /><span className="collection-orbit collection-orbit-two" /><div className="collection-sleeves">{items.slice(0, 3).map((entry, i) => <div className={`collection-sleeve collection-sleeve-${i}`} key={entry.id}><span>{entry.data.year || "ALBUM"}</span><strong>{i === 0 ? current.title : entry.title}</strong><VMark size={35} /></div>)}</div><span className="collection-stage-coordinate">SLEEVE / ARCHIVE<i />{String(index + 1).padStart(2, "0")}</span></div>
    <div className="collection-stage-copy"><p className="collection-stage-kicker"><span />ALBUM EXPLORER / 专辑漫游</p><MotionSwap motionKey={current.id} className="collection-current"><span className="collection-stage-year">{current.data.year || current.data.date?.slice(0, 4) || "PRIVATE COLLECTION"}</span><h2>{current.title}</h2><p>{current.data.description || current.data.artist || "翻开一张专辑，走进一段旋律。"}</p><button className="collection-open" onClick={() => onOpen(current)}>翻开这张专辑<ArrowUpRight size={18} /></button></MotionSwap><div className="collection-stage-controls"><span>{String(index + 1).padStart(2, "0")}<small> / {String(items.length).padStart(2, "0")}</small></span><div><button className="ws-icon-button" aria-label="上一张专辑" disabled={items.length < 2} onClick={() => move(-1)}><ChevronLeft size={18} /></button><button className="ws-icon-button" aria-label="下一张专辑" disabled={items.length < 2} onClick={() => move(1)}><ChevronRight size={18} /></button></div></div></div>
    <GlassLayers />
  </motion.section>;
}
