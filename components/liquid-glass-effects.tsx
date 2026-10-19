"use client";

import { useEffect, useRef } from "react";
import { buildLensDisplacement } from "./liquid-glass-map";

const SVG_NS = "http://www.w3.org/2000/svg";
const SURFACES = [
  ".glass-login .login-glass-card",
  ".stage-site.starsea-site .liquid-glass",
  ".stage-site.starsea-site .collection-stage",
  ".stage-site.starsea-site .ws-music-grid",
  ".stage-site.starsea-site .ws-empty",
  ".stage-site.starsea-site .ws-entry-grid:not(.ws-music-grid):not(.ws-album-grid):not(.ws-photo-grid) .ws-entry-card",
  ".stage-site.starsea-site .ws-album-grid .ws-card-body",
  ".stage-site.starsea-site .ws-photo-grid .ws-card-body",
  ".stage-site.starsea-site .ws-detail-paper",
  ".stage-site.starsea-site .ws-player",
  ".stage-site.starsea-site .ws-modal",
  ".stage-site.starsea-site .ws-star-picker",
  ".stage-site.starsea-site .ws-calendar",
  ".stage-site.starsea-site .ws-calendar-agenda",
  ".stage-site.starsea-site .ws-settings-section",
  ".stage-site.starsea-site .ws-year-card",
  ".stage-site.starsea-site .ws-admin-counts > a",
  ".stage-site.starsea-site .ws-bulk-bar",
  ".stage-site.starsea-site .ws-filter-panel",
  ".stage-site.starsea-site .ws-settings-save",
  ".stage-site.starsea-site header.archive-navigation",
  ".stage-site.starsea-site .nav-dropdown",
  ".stage-site.starsea-site .mobile-nav",
  ".music-dock-presence .music-dock",
  ".music-dock-presence .music-dock-handle",
].join(",");

type HydratedLayers = {
  host: HTMLElement;
  polish: HTMLSpanElement;
  edge: HTMLSpanElement;
};
type Surface = HydratedLayers & {
  filter: SVGFilterElement | null;
  geometry: string;
  visible: boolean;
  position: string | null;
};

// Registration only happens from a GlassLayers effect, after React has
// hydrated these exact nodes. The provider never discovers unhydrated DOM.
const hydratedLayers = new Set<HydratedLayers>();
const layerListeners = new Set<() => void>();
function notifyLayers() { layerListeners.forEach((listener) => listener()); }

/** Render directly inside a glass surface. React owns both decorative nodes
 * from SSR through hydration and unmount; the optical provider owns no children. */
export function GlassLayers() {
  const polishRef = useRef<HTMLSpanElement>(null);
  const edgeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const polish = polishRef.current;
    const edge = edgeRef.current;
    const host = polish?.parentElement;
    if (!polish || !edge || !host || host !== edge.parentElement) return;
    const layers = { host, polish, edge };
    hydratedLayers.add(layers);
    notifyLayers();
    return () => {
      hydratedLayers.delete(layers);
      notifyLayers();
    };
  }, []);
  return <><span ref={polishRef} aria-hidden="true" data-motion-managed="" data-glass-polish="" /><span ref={edgeRef} aria-hidden="true" data-motion-managed="" data-glass-edge="" /></>;
}

function makeLensMap(width: number, height: number, radius: number, lip: number) {
  const map = buildLensDisplacement(width, height, radius, lip);
  const canvas = document.createElement("canvas");
  canvas.width = map.width;
  canvas.height = map.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const pixels = context.createImageData(map.width, map.height);
  pixels.data.set(map.data);
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Mount once outside page transitions. Decorations never own interaction. */
export function LiquidGlassEffects() {
  const definitions = useRef<SVGDefsElement>(null);

  useEffect(() => {
    const defs = definitions.current;
    if (!defs || !window.ResizeObserver || !window.IntersectionObserver) return;
    const surfaces = new Map<HTMLElement, Surface>();
    const supportsRefraction = CSS.supports("backdrop-filter", 'url("#glass-support-check")');
    let sequence = 0;
    let reconcileTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const pending = new Set<Surface>();

    const update = (surface: Surface) => {
      const { host, edge } = surface;
      if (!surface.visible || !host.isConnected) return;
      const computed = getComputedStyle(host);
      // The optical layer sits inside the host's layout border. Its own size
      // avoids a two-pixel map drift, especially visible around round corners.
      const width = edge.offsetWidth;
      const height = edge.offsetHeight;
      if (width < 2 || height < 2) return;
      const radius = Math.min(parseFloat(getComputedStyle(edge).borderTopLeftRadius) || 0, width / 2, height / 2);
      const lip = parseFloat(computed.getPropertyValue("--glass-edge-width")) || 6;
      const geometry = `${width}:${height}:${radius}:${lip}`;
      if (geometry === surface.geometry) return;
      surface.geometry = geometry;
      surface.filter?.remove();
      surface.filter = null;
      if (!supportsRefraction) return;
      const map = makeLensMap(width, height, radius, lip + 1);
      if (!map) return;
      const filter = document.createElementNS(SVG_NS, "filter");
      const id = `archive-liquid-lens-${++sequence}`;
      filter.id = id;
      filter.setAttribute("filterUnits", "userSpaceOnUse");
      filter.setAttribute("primitiveUnits", "userSpaceOnUse");
      filter.setAttribute("x", "0");
      filter.setAttribute("y", "0");
      filter.setAttribute("width", String(width));
      filter.setAttribute("height", String(height));
      filter.setAttribute("color-interpolation-filters", "sRGB");
      const image = document.createElementNS(SVG_NS, "feImage");
      image.setAttribute("href", map);
      image.setAttribute("x", "0");
      image.setAttribute("y", "0");
      image.setAttribute("width", String(width));
      image.setAttribute("height", String(height));
      image.setAttribute("preserveAspectRatio", "none");
      image.setAttribute("result", "lens-map");
      const displacement = document.createElementNS(SVG_NS, "feDisplacementMap");
      displacement.setAttribute("in", "SourceGraphic");
      displacement.setAttribute("in2", "lens-map");
      // The map encodes outward normals. Sample inward for a convex lens,
      // keeping rounded corners inside the backdrop instead of folding black.
      displacement.setAttribute("scale", "-18");
      displacement.setAttribute("xChannelSelector", "R");
      displacement.setAttribute("yChannelSelector", "G");
      filter.append(image, displacement);
      defs.append(filter);
      surface.filter = filter;
      edge.style.setProperty("--glass-refraction-filter", `url("#${id}")`);
      host.dataset.glassRefraction = "supported";
    };
    const queueUpdate = (surface: Surface) => {
      pending.add(surface);
      if (resizeTimer) return;
      resizeTimer = setTimeout(() => {
        resizeTimer = undefined;
        if (disposed) return;
        pending.forEach(update);
        pending.clear();
      }, 70);
    };
    const resize = new ResizeObserver((entries) => {
      entries.forEach(({ target }) => {
        const surface = surfaces.get(target as HTMLElement);
        if (surface) queueUpdate(surface);
      });
    });
    const intersection = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        const surface = surfaces.get(target as HTMLElement);
        if (!surface) return;
        surface.visible = isIntersecting;
        surface.edge.hidden = !isIntersecting;
        if (isIntersecting) queueUpdate(surface);
      });
    }, { rootMargin: "80px" });
    const unregister = (surface: Surface) => {
      resize.unobserve(surface.host);
      intersection.unobserve(surface.host);
      pending.delete(surface);
      surface.filter?.remove();
      surface.edge.style.removeProperty("--glass-refraction-filter");
      surface.edge.hidden = false;
      delete surface.host.dataset.glassOptics;
      delete surface.host.dataset.glassRefraction;
      if (surface.position !== null) surface.host.style.position = surface.position;
    };
    const reconcile = () => {
      reconcileTimer = undefined;
      if (disposed) return;
      const registered = new Set(hydratedLayers);
      surfaces.forEach((surface, host) => {
        const current = [...registered].find((layers) => layers.host === host && layers.edge === surface.edge);
        if (!current || !host.isConnected || !host.matches(SURFACES)) {
          unregister(surface);
          surfaces.delete(host);
        }
      });
      registered.forEach(({ host, polish, edge }) => {
        if (!host.isConnected || !host.matches(SURFACES)) return;
        const active = surfaces.get(host);
        if (active) {
          queueUpdate(active);
          return;
        }
        const position = getComputedStyle(host).position === "static" ? host.style.position : null;
        if (position !== null) host.style.position = "relative";
        host.dataset.glassOptics = "ready";
        const surface: Surface = { host, polish, edge, filter: null, geometry: "", visible: false, position };
        surfaces.set(host, surface);
        resize.observe(host);
        intersection.observe(host);
      });
    };
    const mutations = new MutationObserver(() => {
      if (!reconcileTimer) reconcileTimer = setTimeout(reconcile, 60);
    });
    layerListeners.add(reconcile);
    reconcile();
    // Class changes can move a hydrated card in or out of the eligible layout.
    // Child insertion/removal is exclusively React's registration lifecycle.
    mutations.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => {
      disposed = true;
      mutations.disconnect();
      resize.disconnect();
      intersection.disconnect();
      layerListeners.delete(reconcile);
      clearTimeout(reconcileTimer);
      clearTimeout(resizeTimer);
      surfaces.forEach(unregister);
      defs.replaceChildren();
    };
  }, []);
  return <svg data-liquid-glass-defs="" className="liquid-glass-definitions" aria-hidden="true" width="0" height="0"><defs ref={definitions} /></svg>;
}
