"use client";

import {useState} from "react";
import {ExternalLink, Headphones, LoaderCircle, RotateCcw} from "lucide-react";
import type {Entry} from "@/lib/types";
import {Modal} from "./client-utils";
import {MotionPresence} from "./motion";
import "./netease-player.css";

export function NeteasePlayer({entry, url, embedUrl, onClose}: {entry: Entry; url: string; embedUrl: string; onClose: () => void}) {
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <Modal title="网易云播放器" onClose={onClose}>
    <section className="netease-player" aria-label="网易云音乐播放">
      <span className="netease-player-symbol" aria-hidden="true"><Headphones size={28} /></span>
      <h3>{entry.title}</h3>
      {entry.data.artist && <p className="netease-player-artist">{entry.data.artist}</p>}
      <p className="netease-player-instruction">点击下方播放器中的播放键</p>
      <div className="netease-player-frame">
        <iframe key={attempt} title={`网易云播放器 · ${entry.title}`} src={embedUrl} width="330" height="86" frameBorder="0" sandbox="allow-scripts allow-same-origin allow-popups" allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setLoaded(true)} />
      </div>
      <MotionPresence show={!loaded}><p className="netease-player-loading" role="status"><LoaderCircle className="ws-spin" size={15} />正在加载网易云播放器…</p></MotionPresence>
      <div className="netease-player-actions"><button type="button" className="ws-button ws-button-ghost" onClick={() => {setLoaded(false); setAttempt(value => value + 1);}}><RotateCcw size={15} />重新加载</button><a className="ws-button ws-button-secondary" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />在网易云打开</a></div>

    </section>
  </Modal>;
}
