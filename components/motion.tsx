"use client";

import { Children, cloneElement, createContext, forwardRef, isValidElement, useContext, useEffect, useRef, useSyncExternalStore, ViewTransition, type ReactNode, type ReactElement, type Ref } from "react";
import { AnimatePresence, MotionConfig, motion, useIsPresent } from "motion/react";
import { usePathname } from "next/navigation";
import { GlassLayers } from "./liquid-glass-effects";

const Preference = createContext(true);
const ease = [0.22, 1, 0.36, 1] as const;
const query = "(prefers-reduced-motion: reduce)";
function subscribe(listener: () => void) {
  const media = typeof window.matchMedia === "function" ? window.matchMedia(query) : undefined;
  media?.addEventListener("change", listener);
  return () => media?.removeEventListener("change", listener);
}
function reduced() { return typeof window.matchMedia === "function" && window.matchMedia(query).matches; }

export function useMotionPreference() {
  const enabled = useContext(Preference);
  const reduce = useSyncExternalStore(subscribe, reduced, () => false);
  return enabled && !reduce;
}

export function MotionScope({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const parent = useContext(Preference);
  useEffect(() => {
    document.documentElement.dataset.motion = enabled && parent ? "on" : "off";
    return () => { delete document.documentElement.dataset.motion; };
  }, [enabled, parent]);
  return <Preference.Provider value={enabled && parent}>{children}</Preference.Provider>;
}

/** Keep the original DOM available to React's native route snapshots; never freeze router or auth state. */
export function MotionPage({ children }: { children: ReactNode }) {
  const enabled = useMotionPreference();
  return <ViewTransition name="archive-content" default={enabled ? "archive-page" : "none"}>
    <div className="motion-page">{children}</div>
  </ViewTransition>;
}

export function SharedArtwork({ name, children }: { name: string; children: ReactNode }) {
  const enabled = useMotionPreference();
  return <ViewTransition name={name} share={enabled ? "archive-artwork" : "none"} default="none">{children}</ViewTransition>;
}

type PresenceProps = { show: boolean; children: ReactNode; className?: string; as?: "div" | "span"; preset?: "fade" | "panel" | "menu" };
function PresenceFrame({ children, className, as = "div", preset = "fade", swap = false }: Omit<PresenceProps, "show"> & { swap?: boolean }) {
  const enabled = useMotionPreference();
  const present = useIsPresent();
  const Tag = as === "span" ? motion.span : motion.div;
  const start = preset === "menu" ? { opacity: 0, y: -7, scale: .985 } : { opacity: 0, y: swap ? 4 : preset === "panel" ? 8 : 3 };
  return <Tag className={className} data-motion-managed data-state={present ? "open" : "closing"} inert={!present} aria-hidden={!present}
    initial={enabled ? start : false} animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={enabled ? (swap ? { opacity: 0, y: -3 } : start) : { opacity: 0 }}
    transition={{ duration: enabled ? (swap ? .16 : .24) : 0, ease }}>{children}</Tag>;
}

export function MotionPresence({ show, children, className, as = "div", preset = "fade" }: PresenceProps) {
  return <AnimatePresence initial={false}>
    {show && <PresenceFrame key="presence" className={className} as={as} preset={preset}>{children}</PresenceFrame>}
  </AnimatePresence>;
}

export function MotionSwap({ motionKey, children, className, as = "div" }: { motionKey: string | number; children: ReactNode; className?: string; as?: "div" | "span" }) {
  return <AnimatePresence initial={false} mode="wait">
    <PresenceFrame key={motionKey} className={className} as={as} swap>{children}</PresenceFrame>
  </AnimatePresence>;
}

type RetainedElementProps = { ref?: Ref<HTMLElement>; inert?: boolean; "aria-hidden"?: boolean | "true" | "false" };
const RetainedChild = forwardRef<HTMLElement, { child: ReactElement<RetainedElementProps> }>(function RetainedChild({ child }, ref) {
  const present = useIsPresent();
  // eslint-disable-next-line react-hooks/refs -- cloneElement forwards the DOM ref unchanged without reading ref.current.
  return cloneElement(child, { ref, inert: !present || child.props.inert, "aria-hidden": !present ? true : child.props["aria-hidden"] });
});

export function MotionList({ children, className, glass = false }: { children: ReactNode; className?: string; glass?: boolean }) {
  const enabled = useMotionPreference();
  return <motion.div layout={enabled} className={className} data-motion-managed transition={{ duration: enabled ? .3 : 0, ease }}>
    {glass && <GlassLayers />}
    <AnimatePresence initial={enabled} mode="popLayout">{Children.map(children, child => isValidElement<RetainedElementProps>(child) ? <RetainedChild key={child.key} child={child} /> : child)}</AnimatePresence>
  </motion.div>;
}

const entranceTargets = "h1,h2,h3,h4,p,a,button,label,input,select,textarea,img,svg.v-mark,svg.lucide,figcaption,summary,dt,dd,span:not(:has(*))";

/** Animate server-rendered copy and artwork on entry/scroll without converting pages to client components. */
function ElementEntrances() {
  const enabled = useMotionPreference();
  const seen = useRef(new WeakSet<Element>());
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    const active = new Set<Animation>();
    const observed = new Set<Element>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.target.isConnected) { observer.unobserve(entry.target); observed.delete(entry.target); continue; }
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        observed.delete(entry.target);
        const target = entry.target as HTMLElement;
        if (target.closest(".no-animation,[data-motion-managed]")) continue;
        // A short displacement lets nested text and icons arrive together without large compound motion.
        const animation = target.animate([{ opacity: 0, translate: "0 4px" }, { opacity: 1, translate: "0 0" }], {
          duration: 360, easing: "cubic-bezier(.22,1,.36,1)", delay: Math.min(100, (entries.indexOf(entry) % 6) * 16),
        });
        active.add(animation);
        void animation.finished.then(() => active.delete(animation), () => active.delete(animation));
      }
    }, { rootMargin: "0px 0px -12px 0px", threshold: .01 });
    function scan(root: Element) {
      const targets = [root, ...root.querySelectorAll(entranceTargets)];
      for (const target of targets) {
        if (!target.matches(entranceTargets) || seen.current.has(target) || target.closest("[data-motion-managed],.no-animation")) continue;
        seen.current.add(target);
        observed.add(target);
        observer.observe(target);
      }
    }
    scan(document.body);
    const mutations = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.removedNodes) if (node instanceof Element) {
          for (const target of observed) if (node === target || node.contains(target)) { observer.unobserve(target); observed.delete(target); }
        }
        for (const node of record.addedNodes) if (node instanceof Element) scan(node);
      }
      // A setting can turn off motion while an entrance is still playing.
      if (document.documentElement.dataset.motion === "off") for (const animation of active) animation.cancel();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    mutations.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    return () => { mutations.disconnect(); observer.disconnect(); observed.clear(); for (const animation of active) animation.cancel(); };
  }, [enabled]);
  return null;
}

export function MotionRoot({ children }: { children: ReactNode }) {
  const enabled = useMotionPreference();
  const pathname = usePathname();
  // Private navigation animates the content alone, leaving the live header and its selection marker visible.
  const publicTransition = enabled && !pathname.startsWith("/app");
  return <MotionConfig reducedMotion="user" transition={{ duration: .28, ease }}>
    <ElementEntrances />
    <ViewTransition name="archive-root" default={publicTransition ? "archive-crossfade" : "none"}>
      <div className="motion-root">{children}</div>
    </ViewTransition>
  </MotionConfig>;
}
