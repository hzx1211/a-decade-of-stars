"use client";

import Link from "next/link";
import {useCallback, useEffect, useRef, useState} from "react";
import {ChevronDown, Disc3, ListMusic, LoaderCircle, Pause, Play, SkipBack, SkipForward, Volume2, X} from "lucide-react";
import type {MusicState} from "./music-library";
import {MotionPresence, MotionSwap} from "./motion";
import {GlassLayers} from "./liquid-glass-effects";

type DockMusic = Pick<MusicState, "tracks" | "current" | "playing" | "loading" | "time" | "duration" | "volume" | "error" | "toggle" | "move" | "seek" | "setVolume"> & {openLyrics?: MusicState["openLyrics"]};
const idleDelay = 4_000;
function clock(value: number) { const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

/** The dock owns presentation only; its audio element stays mounted in MusicLibrary. */
export function MusicDock({music, onClose}: {music: DockMusic; onClose: () => void}) {
  return <MotionPresence show={!!music.current} className="music-dock-presence" preset="panel">
    <ActiveMusicDock music={music} onClose={onClose} />
  </MotionPresence>;
}

function ActiveMusicDock({music, onClose}: {music: DockMusic; onClose: () => void}) {
  const trackKey = `${music.current?.entry.id || ""}:${music.error}`;
  // A new song or playback error reveals the controls, but time updates never do.
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  const expanded = hiddenKey !== trackKey;
  const shell = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null);
  const handle = useRef<HTMLButtonElement>(null), playButton = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovering = useRef(false), pointerActive = useRef(false), keyboardFocus = useRef(false), modality = useRef("keyboard");
  const focusPlay = useRef(false), focusHandle = useRef(false), suppressHandleFocus = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);

  const clearIdle = useCallback(() => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  const hasKeyboardFocus = useCallback(() => keyboardFocus.current && !!panel.current?.contains(document.activeElement), []);
  const collapse = useCallback((manual = false) => {
    clearIdle();
    focusHandle.current = manual || !!panel.current?.contains(document.activeElement);
    suppressHandleFocus.current = focusHandle.current;
    hovering.current = false;
    pointerActive.current = false;
    keyboardFocus.current = false;
    setHiddenKey(trackKey);
  }, [clearIdle, trackKey]);
  const scheduleIdle = useCallback(() => {
    clearIdle();
    if (!expanded || hovering.current || pointerActive.current || hasKeyboardFocus()) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!hovering.current && !pointerActive.current && !hasKeyboardFocus()) collapse();
    }, idleDelay);
  }, [clearIdle, collapse, expanded, hasKeyboardFocus]);
  function open() { focusPlay.current = true; setHiddenKey(null); }

  useEffect(() => {
    if (expanded && focusPlay.current) {
      focusPlay.current = false;
      playButton.current?.focus({preventScroll: true});
    } else if (!expanded && focusHandle.current) {
      focusHandle.current = false;
      handle.current?.focus({preventScroll: true});
    }
    scheduleIdle();
    return clearIdle;
  }, [expanded, trackKey, clearIdle, scheduleIdle]);

  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !shell.current?.contains(active)) previousFocus.current = active;
    let scrollPosition = window.scrollY;
    function onKeyDown() { modality.current = "keyboard"; }
    function onPointerDown(event: PointerEvent) {
      modality.current = "pointer";
      if (!shell.current?.contains(event.target as Node)) {
        hovering.current = false;
        pointerActive.current = false;
        keyboardFocus.current = false;
        scheduleIdle();
      }
    }
    function onPointerEnd() {
      if (!pointerActive.current) return;
      pointerActive.current = false;
      scheduleIdle();
    }
    function onFocus(event: FocusEvent) {
      if (event.target instanceof HTMLElement && !shell.current?.contains(event.target)) previousFocus.current = event.target;
    }
    function onScroll(event: Event) {
      if (!expanded || pointerActive.current || hasKeyboardFocus() || shell.current?.contains(event.target as Node)) return;
      const distance = Math.abs(window.scrollY - scrollPosition);
      // Scrollable content panes also count, while tiny browser viewport adjustments do not.
      const nested = event.target instanceof HTMLElement && event.target !== document.documentElement && event.target !== document.body;
      if (distance >= 8 || nested) { scrollPosition = window.scrollY; collapse(); }
    }
    function onWheel(event: WheelEvent) {
      if (expanded && !pointerActive.current && !hasKeyboardFocus() && Math.abs(event.deltaY) >= 8 && !shell.current?.contains(event.target as Node)) collapse();
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocus, true);
    window.addEventListener("pointerup", onPointerEnd, true);
    window.addEventListener("pointercancel", onPointerEnd, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("wheel", onWheel, {passive: true});
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocus, true);
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", onWheel);
    };
  }, [collapse, expanded, hasKeyboardFocus, scheduleIdle]);

  function close() {
    clearIdle();
    const target = previousFocus.current;
    onClose();
    requestAnimationFrame(() => {
      const fallback = document.querySelector<HTMLElement>("#main-content button, main button, header a");
      (target?.isConnected ? target : fallback)?.focus({preventScroll: true});
    });
  }

  return <div ref={shell} className="music-dock-shell" data-testid="music-dock-shell" data-state={expanded ? "expanded" : "collapsed"}>
    <MotionPresence show={expanded} className="music-dock-panel-presence" preset="panel">
      <section ref={panel} className={`music-dock ${music.playing ? "is-playing" : ""}`} role="region" aria-label="音乐播放器"
        onPointerEnter={event => { if (event.pointerType !== "touch") { hovering.current = true; clearIdle(); } }}
        onPointerLeave={() => { hovering.current = false; scheduleIdle(); }}
        onPointerDownCapture={() => { modality.current = "pointer"; pointerActive.current = true; keyboardFocus.current = false; clearIdle(); }}
        onClickCapture={scheduleIdle}
        onKeyDownCapture={event => { modality.current = "keyboard"; keyboardFocus.current = true; clearIdle(); if (event.key === "Escape") { event.preventDefault(); collapse(true); } }}
        onFocusCapture={() => { keyboardFocus.current = modality.current === "keyboard"; if (keyboardFocus.current) clearIdle(); else scheduleIdle(); }}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { keyboardFocus.current = false; scheduleIdle(); } }}>
        <div className="music-dock-track"><span className="music-dock-cover" aria-hidden="true">{music.current?.cover ? <img src={`/api/assets/${music.current.cover.id}`} alt="" /> : <Disc3 size={30} />}</span><MotionSwap motionKey={music.current?.entry.id || ""} className="music-dock-name"><Link href={`/app/music/${music.current?.entry.id}`}>{music.current?.entry.title}</Link><span>{music.current?.entry.data.artist || "私人音乐收藏"}</span></MotionSwap></div>
        <div className="music-dock-center"><div className="music-dock-buttons"><button aria-label="上一首" onClick={() => music.move(-1)} disabled={music.tracks.length < 2}><SkipBack size={17} /></button><button ref={playButton} className="music-dock-play" aria-label={music.playing || music.loading ? "暂停音乐" : "播放音乐"} aria-busy={music.loading} onClick={music.toggle}><MotionSwap motionKey={music.loading ? "loading" : music.playing ? "playing" : "paused"} as="span">{music.loading ? <LoaderCircle size={19} className="ws-spin" /> : music.playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</MotionSwap></button><button aria-label="下一首" onClick={() => music.move(1)} disabled={music.tracks.length < 2}><SkipForward size={17} /></button></div><label className="music-dock-progress"><span>{clock(music.time)}</span><input aria-label="播放进度" aria-valuetext={`${clock(music.time)} / ${clock(music.duration)}`} type="range" min="0" max={music.duration || 1} step="0.1" value={Math.min(music.time, music.duration || 1)} disabled={!music.duration} onChange={event => music.seek(Number(event.target.value))} /><span>{clock(music.duration)}</span></label></div>
        <div className="music-dock-tools">{music.openLyrics && <button type="button" className="music-dock-lyrics" aria-label="打开歌词" title="查看歌词" onClick={() => music.openLyrics?.()}><ListMusic size={19} /></button>}<Volume2 size={17} aria-hidden="true" /><input aria-label="音量" type="range" min="0" max="1" step="0.01" value={music.volume} onChange={event => music.setVolume(Number(event.target.value))} /><button className="music-dock-collapse" aria-label="收起音乐播放器" title="收起播放器，继续听歌" onClick={() => collapse(true)}><ChevronDown size={18} /></button><button aria-label="关闭音乐播放器" title="停止播放并关闭" onClick={close}><X size={17} /></button></div>
        <MotionPresence show={!!music.error} className="music-dock-error"><p role="alert">{music.error}</p></MotionPresence>
        <GlassLayers />
      </section>
    </MotionPresence>
    <MotionPresence show={!expanded} className="music-dock-handle-presence" preset="panel">
      <button ref={handle} className={`music-dock-handle ${music.playing ? "is-playing" : ""}`} aria-label="展开音乐播放器" aria-expanded={false} title={music.current?.entry.title ? `展开播放器 · ${music.current.entry.title}` : "展开播放器"} onClick={open}
        onFocus={() => { if (suppressHandleFocus.current) { suppressHandleFocus.current = false; return; } if (modality.current === "keyboard") open(); }}>
        <Disc3 size={22} aria-hidden="true" /><GlassLayers />
      </button>
    </MotionPresence>
  </div>;
}
