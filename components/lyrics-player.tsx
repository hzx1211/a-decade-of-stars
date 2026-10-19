"use client";

import {useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent} from "react";
import {Check, Clock3, Disc3, ListMusic, LoaderCircle, Minus, Pause, PencilLine, Play, Plus, RotateCcw, SkipBack, SkipForward, Upload} from "lucide-react";
import {getActiveLyricIndex, parseLyrics} from "@/lib/lyrics";
import type {Asset, Entry} from "@/lib/types";
import type {MusicState} from "./music-library";
import {Modal, errorMessage} from "./client-utils";
import {MotionPresence, MotionSwap, useMotionPreference} from "./motion";
import {VMark} from "./v-mark";
import "./lyrics-player.css";

type Props = {
  entry: Entry; cover?: Asset; music: MusicState;
  onSave: (id: string, source: string, offset: number) => Promise<Entry>;
  onClose: () => void;
};
function clock(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function LyricsPlayer(props: Props) {
  const [busy, setBusy] = useState(false);
  return <Modal title="正在听 · 歌词" wide onClose={props.onClose} closeDisabled={busy}>
    <MotionSwap motionKey={props.entry.id} className="lyrics-song-swap"><LyricsContent key={props.entry.id} {...props} busy={busy} setBusy={setBusy} /></MotionSwap>
  </Modal>;
}

function LyricsContent({entry, cover, music, onSave, busy, setBusy}: Props & {busy: boolean; setBusy: (value: boolean) => void}) {
  const animated = useMotionPreference();
  const [source, setSource] = useState(entry.data.lyrics || "");
  const [savedSource, setSavedSource] = useState(entry.data.lyrics || "");
  const [offset, setOffset] = useState(entry.data.lyricsOffset || 0);
  const [savedOffset, setSavedOffset] = useState(entry.data.lyricsOffset || 0);
  const [editing, setEditing] = useState(false), [following, setFollowing] = useState(true);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const lineNodes = useRef<(HTMLButtonElement | HTMLParagraphElement | null)[]>([]);
  const importRequest = useRef(0);
  useEffect(() => () => { ++importRequest.current; }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (document.activeElement === document.body) playButton.current?.focus({preventScroll: true}); });
    return () => cancelAnimationFrame(frame);
  }, []);
  const parsed = useMemo(() => parseLyrics(savedSource), [savedSource]);
  const isCurrent = music.current?.entry.id === entry.id;
  const playable = music.tracks.some(track => track.entry.id === entry.id);
  const playing = isCurrent && music.playing, loading = isCurrent && music.loading;
  const time = isCurrent ? music.time : 0, duration = isCurrent ? music.duration : 0;
  const activeIndex = isCurrent ? getActiveLyricIndex(parsed.lines, time, offset) : -1;
  const dirtyOffset = offset !== savedOffset;

  // The list may mount after MotionSwap finishes its exit; center from its actual ref commit.
  const attachScrollArea = useCallback((area: HTMLDivElement | null) => {
    if (!area || !following || editing) return;
    const frame = requestAnimationFrame(() => {
      const line = lineNodes.current[activeIndex];
      if (!line || !area.isConnected) return;
      const top = area.scrollTop + line.getBoundingClientRect().top - area.getBoundingClientRect().top - area.clientHeight / 2 + line.clientHeight / 2;
      area.scrollTo?.({top: Math.max(0, top), behavior: animated ? "smooth" : "instant"});
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, following, editing, animated]);

  async function save(nextSource: string, nextOffset = offset) {
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await onSave(entry.id, nextSource, nextOffset);
      setSource(saved.data.lyrics || ""); setSavedSource(saved.data.lyrics || "");
      setOffset(saved.data.lyricsOffset || 0); setSavedOffset(saved.data.lyricsOffset || 0);
      setEditing(false); setFollowing(true); setMessage("歌词已保存");
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setError(""); setMessage("");
    if (!/\.(lrc|txt)$/i.test(file.name)) { setError("请选择 LRC 或 TXT 歌词文件。"); return; }
    if (file.size > 300_000) { setError("歌词文件过大，请选择 300 KB 以内的文件。"); return; }
    const request = ++importRequest.current;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text: string;
      if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder("utf-16le").decode(bytes);
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder("utf-16be").decode(bytes);
      else {
        try { text = new TextDecoder("utf-8", {fatal: true}).decode(bytes); }
        catch { text = new TextDecoder("gb18030", {fatal: true}).decode(bytes); }
      }
      if (request !== importRequest.current) return;
      if (text.length > 100_000) throw new Error("歌词最多支持 100000 个字符。");
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) || !parseLyrics(text).lines.length) throw new Error("文件中没有可显示的歌词，请检查内容。");
      await save(text, 0);
    } catch (failure) { if (request === importRequest.current) setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  function toggle() { if (isCurrent && (playing || loading)) music.pause(); else music.play(entry.id); }
  function seekLine(timestamp: number) { music.seek(Math.max(0, timestamp - offset / 1000 + .001)); setFollowing(true); }
  function cancelEditing() { setSource(savedSource); setEditing(false); setError(""); }

  return <section className="lyrics-player" aria-label="歌词播放器" data-synced={parsed.synced}>
    <div className="lyrics-listening">
      <div className={`lyrics-sleeve ${playing && animated ? "is-playing" : ""}`} aria-hidden="true">
        <div className="lyrics-disc"><i /><div className="lyrics-disc-label">{cover ? <img src={`/api/assets/${cover.id}`} alt="" /> : <VMark size={100} />}</div></div>
        <span>THE SOUND OF OUR STARS</span>
      </div>
      <MotionSwap motionKey={entry.id} className="lyrics-track-heading"><span className="lyrics-eyebrow">BLUE STAR SEA</span><h3>{entry.title}</h3><p>{entry.data.artist || "我的音乐收藏"}</p></MotionSwap>
      <div className="lyrics-transport">
        <button type="button" aria-label="歌词页上一首" disabled={music.tracks.length < 2 || !isCurrent || busy} onClick={() => music.move(-1)}><SkipBack size={20} /></button>
        <button ref={playButton} type="button" className="lyrics-play" aria-label={`歌词页${playing || loading ? "暂停" : "播放"}${entry.title}`} aria-busy={loading} disabled={!playable || busy} onClick={toggle}><MotionSwap as="span" motionKey={loading ? "loading" : playing ? "playing" : "paused"}>{loading ? <LoaderCircle className="ws-spin" size={24} /> : playing ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}</MotionSwap></button>
        <button type="button" aria-label="歌词页下一首" disabled={music.tracks.length < 2 || !isCurrent || busy} onClick={() => music.move(1)}><SkipForward size={20} /></button>
      </div>
      <label className="lyrics-progress"><input type="range" aria-label="歌词页播放进度" min="0" max={duration || 1} step="0.1" disabled={!duration} value={Math.min(time, duration || 1)} onChange={event => {music.seek(Number(event.target.value)); setFollowing(true);}} /><span><time>{clock(time)}</time><time>{clock(duration)}</time></span></label>
      {!playable && <p className="lyrics-playback-note">先为这首歌添加音频，就能边听边看歌词。</p>}
      <MotionPresence show={isCurrent && !!music.error}><p className="lyrics-error" role="alert">{music.error}</p></MotionPresence>
    </div>
    <div className="lyrics-reading">
      <div className="lyrics-toolbar"><span><ListMusic size={17} />{editing ? "编辑歌词" : parsed.synced ? "同步歌词" : parsed.lines.length ? "文本歌词" : "歌词"}</span><div><button type="button" onClick={() => fileInput.current?.click()} disabled={busy} aria-label="导入歌词文件"><Upload size={16} />导入</button><button type="button" onClick={() => {setEditing(true); setError(""); setMessage("");}} disabled={busy || editing}><PencilLine size={16} />{savedSource ? "编辑" : "粘贴歌词"}</button></div></div>
      <input ref={fileInput} className="lyrics-file-input" type="file" accept=".lrc,.txt" aria-label="选择歌词文件" onChange={event => void importFile(event)} disabled={busy} />
      <MotionSwap motionKey={editing ? "editor" : parsed.lines.length ? `lyrics-${savedSource}` : "empty"} className="lyrics-content-swap">
        {editing ? <form className="lyrics-editor" onSubmit={event => {event.preventDefault(); void save(source);}}><label htmlFor="lyrics-source">粘贴 LRC 或纯文本歌词</label><textarea autoFocus id="lyrics-source" value={source} maxLength={100_000} disabled={busy} onChange={event => setSource(event.target.value)} spellCheck={false} placeholder="粘贴歌词或带时间标签的 LRC" /><p>LRC 可同步播放，纯文本可直接阅读。清空后保存可移除歌词。</p><div><button type="button" onClick={cancelEditing} disabled={busy}>取消</button><button type="submit" className="lyrics-save" disabled={busy}><Check size={16} />保存歌词</button></div></form>
          : parsed.lines.length ? <div className="lyrics-scroll" ref={attachScrollArea} tabIndex={0} role="region" aria-label="歌词正文" onWheel={() => setFollowing(false)} onTouchMove={() => setFollowing(false)} onKeyDown={event => {if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) setFollowing(false);}}><div className="lyrics-lines">{parsed.lines.map((line, index) => line.time !== null ? <button key={`${line.time}-${index}`} ref={node => {lineNodes.current[index] = node;}} className={`lyrics-line ${index === activeIndex ? "is-current" : ""} ${index < activeIndex ? "is-past" : ""}`} type="button" aria-current={index === activeIndex ? "true" : undefined} aria-label={`${clock(Math.max(0, line.time))} ${line.text || "间奏"}`} data-time={line.time} disabled={!isCurrent || !duration} title={isCurrent ? "点击跳转到这一句" : "播放后可点选歌词"} onClick={() => seekLine(line.time!)}><span>{line.text || <Disc3 size={24} aria-label="间奏" />}</span></button> : <p className="lyrics-line lyrics-text-line" key={index} ref={node => {lineNodes.current[index] = node;}}>{line.text}</p>)}</div></div>
            : <div className="lyrics-empty"><span><ListMusic size={35} /></span><h4>把歌词也收藏进来</h4><p>导入 LRC，跟着旋律逐句亮起<br />也可以粘贴歌词，慢慢读</p><button type="button" className="lyrics-import-primary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={17} />导入歌词</button><small>支持 LRC / TXT</small></div>}
      </MotionSwap>
      <MotionPresence show={!following && parsed.synced && isCurrent && !editing} className="lyrics-follow"><button type="button" onClick={() => setFollowing(true)}><RotateCcw size={14} />回到当前歌词</button></MotionPresence>
      {parsed.lines.length > 0 && !editing && <div className="lyrics-sync-bar">{parsed.synced ? <><span><Clock3 size={15} />歌词校准</span><div><button type="button" aria-label="歌词延后 0.5 秒" disabled={busy || offset <= -600_000} onClick={() => {setOffset(value => Math.max(-600_000, value - 500)); setMessage("");}}><Minus size={15} /></button><output aria-label="歌词时间偏移">{offset > 0 ? `提前 ${(offset / 1000).toFixed(1)}` : offset < 0 ? `延后 ${(-offset / 1000).toFixed(1)}` : "0.0"} 秒</output><button type="button" aria-label="歌词提前 0.5 秒" disabled={busy || offset >= 600_000} onClick={() => {setOffset(value => Math.min(600_000, value + 500)); setMessage("");}}><Plus size={15} /></button>{dirtyOffset && <button type="button" className="lyrics-save-offset" disabled={busy} onClick={() => void save(savedSource)}>保存校准</button>}</div></> : <p>导入 LRC 可同步歌词</p>}</div>}
      <MotionPresence show={busy || !!error || !!message} className="lyrics-feedback"><p className={error ? "lyrics-error" : ""} role={error ? "alert" : "status"}>{busy ? <><LoaderCircle size={15} className="ws-spin" />正在保存歌词…</> : error || <><Check size={15} />{message}</>}</p></MotionPresence>
    </div>
  </section>;
}
