"use client";

import {useCallback, useRef, useState, type CSSProperties, type PointerEvent} from "react";
import {AnimatePresence, motion, useIsPresent} from "motion/react";
import {ArrowUpRight, Check, ChevronRight, Download, Minus, Pause, Play, Plus, RefreshCw, RotateCcw, Star} from "lucide-react";
import {entryKinds, kindLabels, type Entry} from "@/lib/types";
import {getGalaxyRecordPoint, getGalaxyTheme, type GalaxyThemeKey} from "@/lib/galaxy-themes";
import {downloadBlob} from "./client-utils";
import {GlassLayers} from "./liquid-glass-effects";
import {MotionList, MotionPresence, MotionSwap, useMotionPreference} from "./motion";
import {GalaxyScene, projectGalaxyPoint, type GalaxyProjection} from "./galaxy-scene";
import "./star-map.css";

const ease = [.22, 1, .36, 1] as const;

function GalaxyRecord({entry, prominent, index, onOpen}: {entry: Entry; prominent: boolean; index: number; onOpen: (entry: Entry) => void}) {
  const present = useIsPresent();
  const animated = useMotionPreference();
  return <motion.button type="button" className={`galaxy-record ${entry.favorite ? "is-favorite" : ""} ${prominent ? "is-prominent" : ""}`}
    data-star-node={entry.id} data-motion-managed aria-label={`打开${entry.title}`} aria-hidden={!present} inert={!present} tabIndex={present ? 0 : -1}
    initial={animated ? {opacity: 0, scale: .5} : false} animate={{opacity: 1, scale: 1}} exit={{opacity: 0, scale: animated ? .5 : 1}}
    transition={{duration: animated ? .32 : 0, ease}} onClick={() => {if (present) onOpen(entry);}}>
    <span className="galaxy-record-spark" aria-hidden="true"><i /><i /></span>
    <span className="galaxy-record-label"><small>{kindLabels[entry.kind]}</small><strong>{entry.title}</strong><ArrowUpRight size={13} aria-hidden="true" /></span>
    <span className="galaxy-record-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
  </motion.button>;
}

export function StarMapView({entries, onOpen}: {entries: Entry[]; onOpen: (entry: Entry) => void}) {
  const animated = useMotionPreference();
  const [selected, setSelected] = useState(() => [...entries.filter(entry => entry.favorite), ...entries.filter(entry => !entry.favorite)].slice(0, 16).map(entry => entry.id));
  const [filter, setFilter] = useState<GalaxyThemeKey>("all"), [layout, setLayout] = useState(0), [picker, setPicker] = useState(false), [query, setQuery] = useState("");
  const theme = getGalaxyTheme(filter);
  const [rotation, setRotation] = useState(0), [zoom, setZoom] = useState(1), [paused, setPaused] = useState(false), [dragging, setDragging] = useState(false);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const scene = useRef<HTMLDivElement>(null);
  const projectionRef = useRef<GalaxyProjection>({rotation: 0, zoom: 1});
  const drag = useRef<{x: number; rotation: number} | null>(null);
  const nodes = entries.filter(entry => selected.includes(entry.id) && (filter === "all" || entry.kind === filter));
  const placed = nodes.map((entry, index) => ({entry, point: getGalaxyRecordPoint(filter, index, layout)}));
  const available = entries.filter(entry => (filter === "all" || entry.kind === filter) && (!query || entry.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const allVisibleSelected = available.length > 0 && available.every(entry => selected.includes(entry.id));
  const transition = {duration: animated ? .32 : 0, ease};
  const itemMotion = {initial: animated ? {opacity: 0, y: 6} : false as const, animate: {opacity: 1, y: 0}, exit: {opacity: 0, y: -4}, transition};
  const updateProjection = useCallback((projection: GalaxyProjection) => {
    projectionRef.current = projection;
    for (const element of nodeRefs.current.values()) {
      const p = projectGalaxyPoint({radius: Number(element.dataset.radius), angle: Number(element.dataset.angle), height: Number(element.dataset.height)}, projection);
      element.style.left = `${p.x / 12}%`;
      element.style.top = `${p.y / 7.6}%`;
    }
  }, []);

  function toggleVisible() {
    setSelected(current => allVisibleSelected ? current.filter(id => !available.some(entry => entry.id === id)) : [...new Set([...current, ...available.map(entry => entry.id)])]);
  }
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" || event.button !== 0 || (event.target as Element).closest("button")) return;
    drag.current = {x: event.clientX, rotation};
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current) setRotation(drag.current.rotation + (event.clientX - drag.current.x) * .006);
  }
  function stopDrag() {drag.current = null; setDragging(false);}
  function resetView() {
    const currentRotation = projectionRef.current.rotation;
    setRotation(current => current - currentRotation);
    setZoom(1);
  }
  function download() {
    const canvas = scene.current?.querySelector("canvas");
    if (!canvas) return;
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("xmlns", namespace); svg.setAttribute("viewBox", "0 0 1200 760"); svg.setAttribute("width", "1200"); svg.setAttribute("height", "760");
    svg.setAttribute("data-galaxy-theme", filter);
    const title = document.createElementNS(namespace, "title"); title.textContent = `${theme.title} · ${filter === "all" ? "全部珍藏" : kindLabels[filter]}`; svg.append(title);
    const background = document.createElementNS(namespace, "rect"); background.setAttribute("width", "1200"); background.setAttribute("height", "760"); background.setAttribute("fill", "#020714"); svg.append(background);
    const image = document.createElementNS(namespace, "image"); image.setAttribute("href", canvas.toDataURL("image/png")); image.setAttribute("width", "1200"); image.setAttribute("height", "760"); svg.append(image);
    for (const {entry, point} of placed) {
      const p = projectGalaxyPoint(point, projectionRef.current);
      const dot = document.createElementNS(namespace, "circle");
      for (const [key, value] of Object.entries({cx: p.x, cy: p.y, r: 4, fill: entry.favorite ? theme.accent : "#e8f7ff"})) dot.setAttribute(key, String(value));
      svg.append(dot);
      const label = document.createElementNS(namespace, "text");
      for (const [key, value] of Object.entries({x: p.x + 10, y: p.y + 5, fill: "#edf7ff", "font-family": "sans-serif", "font-size": "15", "paint-order": "stroke", stroke: "#071329", "stroke-width": "3", "stroke-linejoin": "round"})) label.setAttribute(key, String(value));
      label.textContent = entry.title; svg.append(label);
    }
    downloadBlob(new Blob([new XMLSerializer().serializeToString(svg)], {type: "image/svg+xml;charset=utf-8"}), "我的追星星系.svg");
  }

  return <div className="ws-star-view secondary-starmap galaxy-view" data-secondary-motion={animated ? "on" : "off"} style={{"--galaxy-accent": theme.accent, "--galaxy-secondary": theme.secondary} as CSSProperties}>
    <div className="ws-toolbar ws-star-toolbar galaxy-toolbar">
      <select aria-label="星系类型筛选" value={filter} onChange={event => setFilter(getGalaxyTheme(event.target.value).key)}><option value="all">所有珍藏类型</option>{entryKinds.map(kind => <option value={kind} key={kind}>{kindLabels[kind]}</option>)}</select>
      <button className="ws-button ws-button-secondary galaxy-picker-trigger" aria-label={`选择星点（${selected.length}）`} aria-expanded={picker} aria-controls="star-record-picker" onClick={() => setPicker(!picker)}><Star size={16} /><span>选择星点</span><span className="galaxy-selection-count">{selected.length}</span></button>
      <button className="ws-button ws-button-ghost" onClick={() => setLayout(layout + 1)}><RefreshCw size={15} />重新布局</button>
      <button className="ws-button ws-button-ghost" disabled={!nodes.length} onClick={download}><Download size={15} />导出所选星系</button>
    </div>
    <motion.div layout={animated} transition={transition} className={`ws-star-layout ${picker ? "has-picker" : ""}`}>
      <MotionPresence show={picker} className="ws-star-picker" preset="panel"><GlassLayers /><div id="star-record-picker">
        <header><span className="ws-eyebrow">YOUR STARS</span><h3>挑选星点</h3></header>
        <label className="ws-field ws-star-search">搜索星点记录<input aria-label="搜索星点记录" placeholder="作品或回忆的名字" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="ws-star-selection-actions"><span>{available.length} 份可选</span><button className="ws-link-button" disabled={!available.length} onClick={toggleVisible}>{allVisibleSelected ? "取消当前选择" : "选择当前记录"}</button></div>
        <MotionList className="ws-selection-list">{available.length ? available.map(entry => <motion.label className="ws-check" key={entry.id} data-motion-managed {...itemMotion}><input type="checkbox" checked={selected.includes(entry.id)} onChange={event => setSelected(event.target.checked ? [...selected, entry.id] : selected.filter(id => id !== entry.id))} /><span>{entry.title}<small>{kindLabels[entry.kind]}</small></span></motion.label>) : <motion.p key="empty-star-picker" className="ws-muted" data-motion-managed {...itemMotion}>{entries.length ? "没有找到对应记录" : "添加珍藏后可在这里选择"}</motion.p>}</MotionList>
      </div></MotionPresence>
      <motion.div layout={animated} transition={transition} className="ws-star-artwork">
        <div ref={scene} id="personal-star-map" className={`galaxy-stage ${dragging ? "is-dragging" : ""}`} data-galaxy-theme={filter} data-galaxy-title={theme.title} role="region" aria-label={`${theme.title}，${nodes.length}个已选择星点`} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}>
          <div className="galaxy-stage-heading"><div><MotionSwap motionKey={filter} className="galaxy-theme-identity"><span className="galaxy-theme-eyebrow">{theme.eyebrow}</span><strong>{theme.title}</strong><span className="galaxy-theme-category">{filter === "all" ? "全部珍藏" : kindLabels[filter]}</span></MotionSwap></div><span className="galaxy-live-indicator"><i />{nodes.length} 颗珍藏星</span></div>
          <div className="galaxy-universe"><GalaxyScene theme={filter} animated={animated && !paused && !dragging} motionEnabled={animated} rotation={rotation} zoom={zoom} onFrame={updateProjection} />
          <div className="galaxy-record-layer">
            <AnimatePresence>{placed.map(({entry, point}, index) => {
              const p = projectGalaxyPoint(point, {rotation, zoom, inclination: theme.inclination, positionAngle: theme.positionAngle});
              return <motion.div key={entry.id} layout={animated ? "position" : false} layoutDependency={`${layout}:${filter}:${selected.join(",")}`} transition={{...transition, duration: animated ? .82 : 0}} ref={element => {
                if (element) {
                  nodeRefs.current.set(entry.id, element);
                  const current = projectGalaxyPoint(point, projectionRef.current);
                  element.style.left = `${current.x / 12}%`; element.style.top = `${current.y / 7.6}%`;
                } else nodeRefs.current.delete(entry.id);
              }} data-radius={point.radius} data-angle={point.angle} data-height={point.height} className="galaxy-node-position" style={{left: `${p.x / 12}%`, top: `${p.y / 7.6}%`}}><GalaxyRecord entry={entry} index={index} prominent={index < 4} onOpen={onOpen} /></motion.div>;
            })}</AnimatePresence>
          </div></div>
          <div className="galaxy-stage-bottom"><span className="galaxy-drag-hint">拖动旋转 · 点击星点查看珍藏</span><div className="galaxy-view-controls" role="group" aria-label="星系视角">
            <button type="button" aria-label="缩小星系" disabled={zoom <= .75} onClick={() => setZoom(value => Math.max(.75, value - .1))}><Minus size={17} /></button><output aria-label="星系缩放">{Math.round(zoom * 100)}%</output><button type="button" aria-label="放大星系" disabled={zoom >= 1.3} onClick={() => setZoom(value => Math.min(1.3, value + .1))}><Plus size={17} /></button><span />
            <button type="button" aria-label="重置星系视角" onClick={resetView}><RotateCcw size={16} /></button>
            <button type="button" aria-label={paused ? "继续星系自转" : "暂停星系自转"} aria-pressed={paused} disabled={!animated} onClick={() => setPaused(!paused)}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>
          </div></div>
        </div>
        <MotionPresence show={!nodes.length} className="galaxy-empty" preset="panel"><p data-star-empty>{entries.length ? "选择几份珍藏，点亮你的星系" : "添加第一份珍藏，点亮一颗属于你的星"}</p></MotionPresence>
        <MotionPresence show={nodes.length > 0} className="secondary-star-mobile-browser galaxy-record-browser" preset="panel"><div role="region" aria-label="星点记录浏览"><header><div><span className="ws-eyebrow">STORIES IN THE STARS</span><strong>星系里的珍藏</strong></div><span>{nodes.length} 颗已点亮</span></header><MotionList className="secondary-star-mobile-list">{nodes.map((node, index) => <motion.button type="button" key={node.id} data-motion-managed {...itemMotion} aria-label={`查看${node.title}，${kindLabels[node.kind]}`} onClick={() => onOpen(node)}><span className={`secondary-star-mobile-index ${node.favorite ? "is-favorite" : ""}`} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span className="secondary-star-mobile-copy"><strong>{node.title}</strong><small>{kindLabels[node.kind]}</small></span>{node.favorite ? <Check size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}</motion.button>)}</MotionList></div></MotionPresence>
      </motion.div>
    </motion.div>
  </div>;
}
