"use client";

import { useCallback, useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronsUpDown, RotateCcw } from "lucide-react";
import { SharedArtwork, useMotionPreference } from "./motion";

// Every pleat is cut from one continuous photograph between two circular arcs.
// Both the paper and exposed ribs rotate around the same physical pin.
const hinge = { x: 500, y: 595 };
const outerRadius = 500;
const innerRadius = 86;
const spread = 162;
const count = 15;
const point = (radius: number, angle: number) => {
  const radians = angle * Math.PI / 180;
  return { x: hinge.x + Math.sin(radians) * radius, y: hinge.y - Math.cos(radians) * radius };
};
const coordinates = ({ x, y }: { x: number; y: number }) => `${x.toFixed(3)} ${y.toFixed(3)}`;
function sector(start: number, end: number, samples = 9) {
  const points = [
    ...Array.from({ length: samples }, (_, i) => point(outerRadius, start + (end - start) * i / (samples - 1))),
    ...Array.from({ length: samples }, (_, i) => point(innerRadius, end - (end - start) * i / (samples - 1))),
  ];
  const clip = `polygon(${points.map(({ x, y }) => `${(x / 10).toFixed(4)}% ${(y / 6.5).toFixed(4)}%`).join(", ")})`;
  const outer = `M ${coordinates(point(outerRadius, start))} A ${outerRadius} ${outerRadius} 0 0 1 ${coordinates(point(outerRadius, end))}`;
  const inner = `M ${coordinates(point(innerRadius, start))} A ${innerRadius} ${innerRadius} 0 0 1 ${coordinates(point(innerRadius, end))}`;
  const path = `${outer} L ${coordinates(point(innerRadius, end))} A ${innerRadius} ${innerRadius} 0 0 0 ${coordinates(point(innerRadius, start))} Z`;
  return { clip, outer, inner, path };
}
const fanClip = sector(-spread / 2, spread / 2, 81).clip;
const leaves = Array.from({ length: count }, (_, index) => {
  const start = -spread / 2 + index * spread / count;
  const end = start + spread / count;
  const angle = (start + end) / 2;
  return { ...sector(start - .045, end + .045), angle, start, end };
});
const ease = [.22, .78, .2, 1] as const;

export function FanPortrait({ src, mobileSrc, alt }: { src: string; mobileSrc: string; alt: string }) {
  const animated = useMotionPreference();
  const identifier = useId().replace(/:/g, "");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [settled, setSettled] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    // Cached images may decode before React attaches the load event.
    if (image?.complete && image.naturalWidth > 0) setLoaded(true);
  }, []);
  const moving = animated && loaded && !failed && !settled;
  const state = failed ? "error" : !loaded ? "loading" : moving ? expanded ? "opening" : "closing" : expanded ? "ready" : "closed";
  const leafAnimation = (angle: number) => ({ rotate: loaded && expanded ? 0 : -angle, opacity: loaded && !failed ? 1 : 0 });
  const complete = () => {
    if (!loaded || failed) return;
    if (replaying && !expanded) {
      setReplaying(false);
      setExpanded(true);
    } else setSettled(true);
  };
  const toggle = () => {
    if (!loaded || moving || failed) return;
    setSettled(false);
    setExpanded(!expanded);
  };

  return <div className="fan-portrait" data-motion-managed data-fan-state={state}>
    <SharedArtwork name="home-main-image">
      <div className="fan-artwork" id={`${identifier}-artwork`}>
        <div className="fan-halo" aria-hidden="true" />
        <picture className="fan-original" style={{ clipPath: fanClip }}>
          <source media="(max-width: 700px)" srcSet={mobileSrc} />
          <img ref={imageRef} src={src} alt={alt} fetchPriority="high" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
        </picture>
        <div className="fan-ribs" aria-hidden="true">
          {leaves.map((leaf, index) => <motion.div key={index} className="fan-rib" style={{ transformOrigin: "50% 91.53846%" }}
            initial={{ rotate: animated ? -leaf.angle : 0, opacity: 0 }} animate={leafAnimation(leaf.angle)}
            transition={{ duration: animated ? expanded ? 1.75 : .85 : 0, delay: animated && expanded ? index * .025 : 0, ease }}>
            <svg viewBox="0 0 1000 650" fill="none"><path d={`M ${hinge.x} ${hinge.y} L ${coordinates(point(innerRadius + 12, leaf.angle))}`} stroke="#c6bfa6" strokeWidth="3" /><path d={`M ${hinge.x} ${hinge.y} L ${coordinates(point(innerRadius + 12, leaf.angle))}`} stroke="#fff4d3" strokeOpacity=".3" strokeWidth=".8" /></svg>
          </motion.div>)}
        </div>
        <div className="fan-leaves" aria-hidden="true">
          {leaves.map((leaf, index) => {
            const lightStart = point(outerRadius * .7, leaf.start);
            const lightEnd = point(outerRadius * .7, leaf.end);
            return <motion.div key={index} className="fan-leaf" style={{ clipPath: leaf.clip, transformOrigin: "50% 91.53846%", zIndex: count - index }}
              initial={{ rotate: animated ? -leaf.angle : 0, opacity: 0 }} animate={leafAnimation(leaf.angle)}
              transition={{ duration: animated ? expanded ? 1.75 : .85 : 0, delay: animated && expanded ? index * .025 : 0, ease, opacity: { duration: animated ? .3 : 0 } }}
              onAnimationComplete={index === leaves.length - 1 ? (definition) => {
                // Ignore a late completion from the pre-load or interrupted
                // target; ready means that the requested fold actually ended.
                if (typeof definition === "object" && "opacity" in definition && definition.opacity === 1 && "rotate" in definition && definition.rotate === (expanded ? 0 : -leaf.angle)) complete();
              } : undefined}>
              <picture><source media="(max-width: 700px)" srcSet={mobileSrc} /><img src={src} alt="" /></picture>
              <svg className="fan-fold-detail" viewBox="0 0 1000 650" fill="none">
                <defs><linearGradient id={`${identifier}-fold-${index}`} gradientUnits="userSpaceOnUse" x1={lightStart.x} y1={lightStart.y} x2={lightEnd.x} y2={lightEnd.y}>
                  <stop stopColor="#000" stopOpacity=".24" /><stop offset=".35" stopColor="#000" stopOpacity="0" /><stop offset=".8" stopColor="#fff" stopOpacity=".025" /><stop offset="1" stopColor="#fff" stopOpacity=".16" />
                </linearGradient></defs>
                <path d={leaf.path} fill={`url(#${identifier}-fold-${index})`} />
                <path d={leaf.outer} stroke="#eee1c8" strokeOpacity=".7" strokeWidth="2.2" />
                <path d={leaf.inner} stroke="#d4c9b5" strokeOpacity=".6" strokeWidth="1.5" />
                <path d={`M ${coordinates(point(innerRadius, leaf.start))} L ${coordinates(point(outerRadius, leaf.start))}`} stroke="#e7e7f0" strokeOpacity=".16" strokeWidth="1" />
              </svg>
            </motion.div>;
          })}
        </div>
        <motion.span className="fan-hinge" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: loaded && !failed ? 1 : 0 }} transition={{ duration: animated ? .4 : 0 }}><span /></motion.span>
        <AnimatePresence>
          {failed && <motion.p className="fan-image-error" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>照片暂时无法加载，请刷新重试</motion.p>}
        </AnimatePresence>
      </div>
    </SharedArtwork>
    <div className="fan-controls">
      <motion.span className="fan-artwork-note" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: animated ? .4 : 0 }}>一帧现场 · 展成一面星光</motion.span>
      <motion.button className="fan-toggle" type="button" aria-disabled={!loaded || moving || failed} aria-busy={moving} aria-controls={`${identifier}-artwork`} aria-expanded={expanded}
        aria-label={expanded ? "收起照片折扇" : "展开照片折扇"} onClick={toggle}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} whileHover={animated && !moving ? { scale: 1.035 } : undefined} whileTap={animated && !moving ? { scale: .97 } : undefined} transition={{ duration: animated ? .25 : 0 }}>
        <ChevronsUpDown size={14} strokeWidth={1.4} /><span>{expanded ? "收起扇面" : "展开扇面"}</span>
      </motion.button>
      <AnimatePresence>
        {animated && !failed && <motion.button className="fan-replay" type="button" aria-disabled={!loaded || moving || !expanded} aria-busy={moving} aria-label="重播照片的折扇展开动画"
          onClick={() => { if (!loaded || moving || !expanded) return; setSettled(false); setReplaying(true); setExpanded(false); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: animated ? .2 : 0 }}>
          <RotateCcw size={14} strokeWidth={1.4} />
        </motion.button>}
      </AnimatePresence>
    </div>
    <noscript><style>{`.fan-original { opacity: 1 !important; } .fan-controls { display: none; }`}</style></noscript>
  </div>;
}
