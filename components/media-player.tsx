"use client";

import { useState, type SyntheticEvent } from "react";
import { ExternalLink, Headphones, Film, Play, Pause, ListMusic } from "lucide-react";
import type { Asset, Entry } from "@/lib/types";
import {parseNeteaseMusic} from "@/lib/netease";
import { officialEmbedUrl } from "@/lib/validation/schemas";
import { MotionPresence, MotionSwap, SharedArtwork } from "./motion";
import { useMusicLibrary } from "./music-library";
import { GlassLayers } from "./liquid-glass-effects";

export function MediaPlayer({ entry, assets, sharedArtwork = false }: { entry: Entry; assets: Asset[]; sharedArtwork?: boolean }) {
  const music = useMusicLibrary();
  const [error, setError] = useState("");
  function pauseOtherPlayers(event: SyntheticEvent<HTMLMediaElement>) { for (const player of document.querySelectorAll<HTMLMediaElement>("audio,video")) if (player !== event.currentTarget) player.pause(); }
  const [loading, setLoading] = useState(false);
  const [embed, setEmbed] = useState(false);
  const asset = assets.find(item => item.id === entry.data.assetId);
  const cover = assets.find(item => item.id === entry.data.coverAssetId);
  const external = entry.data.externalUrl;
  // Only recognized official-platform addresses, never arbitrary iframe URLs.
  let embedUrl: string | undefined;
  if (entry.data.sourceType === "official_embed" && external) {
    embedUrl = officialEmbedUrl(external) || undefined;
  }
  const canPlay = !!asset && ((entry.kind === "music" && asset.mediaType === "audio") || (entry.kind === "videos" && asset.mediaType === "video"));
  const netease = entry.kind === "music" && parseNeteaseMusic(external || "");
  const photo = asset ? <img src={`/api/assets/${asset.id}`} alt={entry.title} onError={() => setError("照片文件无法读取，请检查素材是否存在。")} /> : null;
  if (entry.kind === "photos") return asset ? <div className="ws-photo-detail">{sharedArtwork ? <SharedArtwork name={`entry-image-${entry.id}`}>{photo}</SharedArtwork> : photo}<MotionPresence show={!!error}><p className="ws-error" role="alert">{error}</p></MotionPresence></div> : <div className="ws-media-empty">尚未添加照片文件。编辑记录即可上传。</div>;
  if (netease && (entry.data.sourceType === "official_embed" || !canPlay)) return <div className="ws-player"><GlassLayers /><div className="ws-audio-art"><Headphones size={38} /><div><span>NETEASE MUSIC</span><strong>{entry.title}</strong><p>{entry.data.artist || "网易云官方播放器"}</p></div></div>{music ? <button type="button" className="ws-button" onClick={() => music.play(entry.id)}><Play size={17} />网易云播放</button> : <a className="ws-button" href={netease.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />在网易云打开</a>}</div>;
  if (canPlay && asset.mediaType === "audio" && music) {
    const active = music.current?.entry.id === entry.id && music.playing;
    return <div className="ws-player"><GlassLayers /><div className="ws-audio-art">{cover ? <img src={`/api/assets/${cover.id}`} alt={`${entry.title}封面`} /> : <Headphones size={38} />}<div><span>PRIVATE LISTENING</span><strong>{entry.title}</strong><p>{entry.data.artist || "私人音乐收藏"}</p></div></div><button className="ws-button" aria-label={`${active ? "暂停" : "播放"}${entry.title}`} onClick={() => active ? music.toggle() : music.play(entry.id)}>{active ? <Pause size={17} /> : <Play size={17} />}{active ? "暂停播放" : "播放这首歌"}</button><button type="button" className="ws-button ws-button-secondary" onClick={() => music.openLyrics(entry.id)}><ListMusic size={17} />查看歌词</button></div>;
  }
  return <div className="ws-player">
    <GlassLayers />
    {canPlay && asset.mediaType === "audio" ? <><div className="ws-audio-art">{cover ? <img src={`/api/assets/${cover.id}`} alt={`${entry.title}封面`} /> : <Headphones size={38} />}<div><span>PRIVATE LISTENING</span><strong>{entry.title}</strong><p>{entry.data.artist || "未填写艺术家"}</p></div></div><audio key={asset.id} onPlay={pauseOtherPlayers} controls preload="metadata" src={`/api/assets/${asset.id}`} onLoadStart={() => setLoading(true)} onLoadedMetadata={() => setLoading(false)} onCanPlay={() => setLoading(false)} onError={() => { setLoading(false); setError("音频无法播放：文件不存在，或浏览器不支持当前编码。可尝试 MP3、WAV 或 OGG 格式。"); }} aria-label={`播放${entry.title}`} /></> : canPlay && asset.mediaType === "video" ? <video key={asset.id} onPlay={pauseOtherPlayers} controls playsInline preload="metadata" poster={cover ? `/api/assets/${cover.id}` : undefined} src={`/api/assets/${asset.id}`} onLoadStart={() => setLoading(true)} onLoadedMetadata={() => setLoading(false)} onCanPlay={() => setLoading(false)} onError={() => { setLoading(false); setError("视频无法播放：文件不存在，或当前浏览器不支持编码。本网站不会自动转码，请尝试 H.264 MP4 或 WebM。"); }} aria-label={`播放${entry.title}`} /> : <MotionSwap motionKey={embedUrl && embed ? "official-player" : "player-preview"}>{embedUrl && embed ? <><iframe title={entry.title} src={embedUrl} sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></> : <div className="ws-media-empty"><Film size={30} /><p>{asset && !canPlay ? "文件类型与当前记录不匹配，请重新选择歌曲或视频文件。" : "这段旋律与舞台，等待你亲自收藏。"}</p>{embedUrl && <button type="button" className="ws-button" onClick={() => setEmbed(true)}>加载官方播放器</button>}</div>}</MotionSwap>}
    <MotionPresence show={loading}><p className="ws-muted" role="status">正在读取媒体…</p></MotionPresence>
    <MotionPresence show={!!error}><p className="ws-error" role="alert">{error}</p></MotionPresence>
    {external && <a href={external} target="_blank" rel="noopener noreferrer" className="ws-button ws-button-secondary"><ExternalLink size={16} />前往原始平台{entry.kind === "music" ? "收听" : "观看"}</a>}
  </div>;
}
