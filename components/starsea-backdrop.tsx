"use client";

import { useEffect, useRef } from "react";
import { useMotionPreference } from "./motion";
import "./starsea-backdrop.css";

const frameSource = /^\/api\/starsea-frames\/[a-z\d_-]+\.(?:webp|png|jpe?g)$/i;
const smooth = (value: number) => value * value * (3 - 2 * value);
const random = (seed: number) => { const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };
type DecodedFrame = { src: string; url: string };

/** Never expose a partially loaded image, and release pending image work when the scene pauses. */
async function decodedFrame(src: string, signal: AbortSignal): Promise<DecodedFrame | undefined> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(abort, 15_000);
  let objectUrl: string | undefined;
  try {
    if (signal.aborted) return undefined;
    const response = await fetch(src, { signal: controller.signal, cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return undefined;
    const bytes = await response.blob();
    if (controller.signal.aborted) return undefined;
    objectUrl = URL.createObjectURL(bytes);
    const url = objectUrl;
    const healthy = await new Promise<boolean>(resolve => {
      const image = new Image();
      let settled = false;
      function finish(loaded: boolean) {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener("abort", cancel);
        image.onload = image.onerror = null;
        if (!loaded) image.removeAttribute("src");
        resolve(loaded);
      }
      function cancel() { finish(false); }
      if (controller.signal.aborted) { finish(false); return; }
      controller.signal.addEventListener("abort", cancel, { once: true });
      image.decoding = "async";
      image.onload = () => {
        if (!image.naturalWidth) { finish(false); return; }
        if (typeof image.decode === "function") void image.decode().then(() => finish(!controller.signal.aborted), () => finish(false));
        else finish(!controller.signal.aborted);
      };
      image.onerror = () => finish(false);
      image.src = url;
    });
    if (healthy && !controller.signal.aborted) return { src, url };
  } catch { /* An unavailable frame leaves the healthy sequence and canvas intact. */ }
  finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  return undefined;
}

/** A blue concert sea with an optional, authenticated sequence of fully decoded image keyframes. */
export function StarseaBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const imageLayerA = useRef<HTMLDivElement>(null);
  const imageLayerB = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  const frameCache = useRef<{ checked: boolean; sources: string[] | null; attempted: string[]; images: DecodedFrame[]; startedAt: number; appeared: boolean; failed: boolean }>({ checked: false, sources: null, attempted: [], images: [], startedAt: 0, appeared: false, failed: false });
  const enabled = useMotionPreference();

  useEffect(() => {
    const cache = frameCache.current;
    return () => { for (const image of cache.images) URL.revokeObjectURL(image.url); };
  }, []);

  useEffect(() => {
    const surface = canvas.current, scene = frame.current;
    const layers = [imageLayerA.current, imageLayerB.current];
    const context = surface?.getContext("2d", { alpha: true });
    if (!surface || !context || !scene || !layers[0] || !layers[1]) return;
    let width = 0, height = 0, request = 0, last = 0, time = clock.current, previous = 0;
    let disposed = false, meteorState = "", meteorCount = -1, meteorGroup = "", meteorGroupSize = -1, frameIndex = -1;
    let pending: AbortController | undefined;
    const cache = frameCache.current;
    // Shared sprites keep the light field and meteor heads within a 30 fps budget.
    const glow = document.createElement("canvas");
    glow.width = glow.height = 80;
    const glowContext = glow.getContext("2d");
    if (glowContext) {
      const halo = glowContext.createRadialGradient(40, 40, 0, 40, 40, 40);
      halo.addColorStop(0, "#d5f5ff");
      halo.addColorStop(.055, "#98dcffdf");
      halo.addColorStop(.15, "#37aaff9c");
      halo.addColorStop(.35, "#167aff38");
      halo.addColorStop(.66, "#126bff12");
      halo.addColorStop(1, "#125fff00");
      glowContext.fillStyle = halo;
      glowContext.fillRect(0, 0, 80, 80);
    }
    const flare = document.createElement("canvas");
    flare.width = flare.height = 120;
    const flareContext = flare.getContext("2d");
    if (flareContext) {
      flareContext.drawImage(glow, 0, 0, 120, 120);
      flareContext.fillStyle = "#93d4ff85";
      flareContext.beginPath();
      flareContext.moveTo(60, 0);
      flareContext.bezierCurveTo(62, 49, 65, 56, 113, 60);
      flareContext.bezierCurveTo(65, 63, 62, 69, 60, 120);
      flareContext.bezierCurveTo(58, 69, 55, 63, 7, 60);
      flareContext.bezierCurveTo(55, 56, 58, 49, 60, 0);
      flareContext.fill();
      flareContext.fillStyle = "#d2f1ff";
      flareContext.beginPath();
      flareContext.arc(60, 60, 2, 0, Math.PI * 2);
      flareContext.fill();
    }
    const stars = Array.from({ length: 102 }, (_, index) => ({
      x: random(index + 1), y: random(index + 201) * .76,
      phase: index * 1.71, radius: index % 11 === 0 ? 1.05 : .55, flare: index % 31 === 0,
    }));
    const lights = Array.from({ length: 860 }, (_, index) => ({
      // Each photon has its own depth and lateral jitter: no rows or rigid dotted grid.
      depth: random(index + 401) ** .72, column: random(index + 1801),
      phase: index * 2.399, bright: index % 11 === 0, flare: index % 157 === 0,
    }));
    // Different constellations share a direction, not a path or a single repeated comet.
    const ensembleStarts = [0, 7.2, 15.1, 21.8, 29.4, 37.8, 44.5, 52];
    const ensembles = ensembleStarts.map((start, group) => ({
      start,
      desktopCount: 3 + group % 3,
      mobileCount: 2 + group % 2,
      meteors: Array.from({ length: 5 }, (_, index) => {
        const seed = 6001 + group * 37 + index * 11;
        return {
          delay: index * (.22 + random(seed) * .1),
          duration: 1.7 + random(seed + 1) * .5,
          entrance: .44 + index * .13 + random(seed + 2) * .13,
          altitude: .025 + random(seed + 3) * .23,
          distance: .18 + random(seed + 4) * .085,
          slope: .38 + random(seed + 5) * .1,
          tail: .7 + random(seed + 6) * .5,
          strength: .62 + random(seed + 7) * .3,
        };
      }),
    }));

    function publishMeteors(count: number, group = "none", groupSize = 0) {
      const nextState = !enabled ? "disabled" : count ? "passing" : "waiting";
      if (nextState !== meteorState) { meteorState = nextState; scene?.setAttribute("data-meteor-state", nextState); }
      if (count !== meteorCount) { meteorCount = count; scene?.setAttribute("data-meteor-count", String(count)); }
      if (group !== meteorGroup) { meteorGroup = group; scene?.setAttribute("data-meteor-group", group); }
      if (groupSize !== meteorGroupSize) { meteorGroupSize = groupSize; scene?.setAttribute("data-meteor-group-size", String(groupSize)); }
    }

    // The edges retain their electric blue; fewer bright cores cross the reading column.
    function readingBalance(column: number) {
      return .3 + smooth(Math.min(1, Math.abs(column - .5) / .44)) * .7;
    }

    function paintImages() {
      if (!scene || !layers[0] || !layers[1] || !cache.images.length) return;
      const age = Math.max(0, time - cache.startedAt);
      const period = 32 / cache.images.length, fade = Math.min(4, period / 2);
      const index = Math.floor(age / period) % cache.images.length;
      const nextIndex = (index + 1) % cache.images.length;
      const dissolve = cache.images.length > 1 ? smooth(Math.max(0, Math.min(1, (age % period - period + fade) / fade))) : 0;
      // Swap layer roles, rather than sources, at the end of a dissolve.
      const currentLayer = Math.floor(age / period) % 2, nextLayer = 1 - currentLayer;
      const current = layers[currentLayer], upcoming = layers[nextLayer];
      if (!current || !upcoming) return;
      if (!enabled || age >= 1.8) cache.appeared = true;
      const appearance = cache.appeared ? 1 : smooth(Math.min(1, age / 1.8));
      const image = cache.images[index], next = cache.images[nextIndex];
      if (current.dataset.src !== image.src) {
        current.style.backgroundImage = `url("${image.url}")`;
        current.dataset.src = image.src;
      }
      if (upcoming.dataset.src !== next.src) {
        upcoming.style.backgroundImage = `url("${next.url}")`;
        upcoming.dataset.src = next.src;
      }
      current.style.zIndex = "0";
      upcoming.style.zIndex = "1";
      // Keep the outgoing shot opaque beneath the incoming shot to avoid a dark dip.
      current.style.opacity = String(appearance);
      upcoming.style.opacity = String(appearance * dissolve);
      if (frameIndex !== index) { frameIndex = index; scene.dataset.frameIndex = String(index); }
    }

    async function loadFrames() {
      if (cache.checked || pending || document.hidden || disposed || (!enabled && cache.images.length)) return;
      const controller = new AbortController();
      pending = controller;
      if (scene) scene.dataset.frameState = enabled ? cache.images.length ? "ready" : "loading" : "paused";
      try {
        if (!cache.sources) {
          const response = await fetch("/api/starsea-frames", { signal: controller.signal, cache: "no-store", credentials: "same-origin" });
          if (!response.ok) throw new Error("Background unavailable");
          const manifest: unknown = await response.json();
          const candidates = manifest && typeof manifest === "object" && "version" in manifest && manifest.version === 1 && "frames" in manifest && Array.isArray(manifest.frames)
            ? manifest.frames.map((item: unknown) => item && typeof item === "object" && "src" in item && typeof item.src === "string" ? item.src : "").filter(src => frameSource.test(src)).slice(0, 6) : [];
          if (controller.signal.aborted || disposed) return;
          cache.sources = [...new Set(candidates)];
        }
        const sources = cache.sources;
        const remaining = sources.filter(src => !cache.attempted.includes(src));
        const previousCount = cache.images.length;
        if (enabled) {
          const results = await Promise.all(remaining.map(src => decodedFrame(src, controller.signal)));
          const healthy = results.filter((image): image is DecodedFrame => Boolean(image));
          if (controller.signal.aborted || disposed) { for (const image of healthy) URL.revokeObjectURL(image.url); return; }
          cache.images = [...cache.images, ...healthy].sort((a, b) => sources.indexOf(a.src) - sources.indexOf(b.src));
          cache.attempted.push(...remaining);
        } else {
          // Reduced motion still gets one decoded, fully visible still; later frames wait.
          for (const src of remaining) {
            const image = await decodedFrame(src, controller.signal);
            if (controller.signal.aborted || disposed) { if (image) URL.revokeObjectURL(image.url); return; }
            cache.attempted.push(src);
            if (image) { cache.images.push(image); break; }
          }
        }
        cache.checked = cache.attempted.length >= sources.length;
        cache.failed = sources.length > 0 && !cache.images.length;
        if (cache.images.length > previousCount) cache.startedAt = time;
        if (scene) {
          scene.dataset.frameCount = String(cache.images.length);
          scene.dataset.frameState = !enabled || document.hidden ? "paused" : cache.images.length ? "ready" : cache.failed ? "error" : "empty";
        }
        paintImages();
      } catch {
        if (!controller.signal.aborted && !disposed) {
          cache.checked = true;
          cache.failed = true;
          if (scene) scene.dataset.frameState = !enabled || document.hidden ? "paused" : "error";
        }
      } finally { if (pending === controller) pending = undefined; }
    }

    function draw() {
      if (!context) return;
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";
      // Irregular, overlapping currents connect individual lights into a flowing sea.
      for (let band = 0; band < 5; band++) {
        context.beginPath();
        for (let point = 0; point <= 18; point++) {
          const x = point / 18 * width;
          const y = height * (.52 + band * .094) + Math.sin(point * .52 + band * 1.8 + time * .18) * (12 + band * 4) + Math.sin(point * .93 - time * .12) * 8;
          if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.strokeStyle = band % 2 ? "#24b9ff" : "#167aff";
        context.lineWidth = 2 + band * .8;
        context.globalAlpha = .021 + band * .004;
        context.stroke();
      }
      for (const star of stars) {
        const twinkle = (Math.sin(time * .85 + star.phase) + 1) * .5;
        const x = star.x * width, y = star.y * height;
        const balance = readingBalance(star.x);
        if (star.flare) {
          const size = 15 + twinkle ** 3 * 12;
          context.globalAlpha = (.13 + twinkle ** 3 * .3) * balance;
          context.drawImage(flare, x - size / 2, y - size / 2, size, size);
        }
        context.globalAlpha = (.2 + twinkle * .38) * balance;
        context.fillStyle = star.flare ? "#bbdfff" : "#7ebcff";
        context.beginPath();
        context.arc(x, y, star.radius, 0, Math.PI * 2);
        context.fill();
      }
      for (let index = 0; index < lights.length; index++) {
        if (width < 700 && index % 3 === 0) continue;
        const light = lights[index];
        const depth = light.depth ** 1.5;
        const current = Math.sin(light.column * 11 + time * .38 + light.depth * 7);
        const x = width * (-.08 + light.column * 1.16) + Math.sin(time * .34 + light.phase) * (1 + depth * 5);
        const y = height * (.48 + depth * .56) + current * (9 + depth * 19) + Math.sin(light.phase) * (2 + depth * 5);
        const shimmer = (Math.sin(time * 1.15 + light.phase) + 1) * .5;
        const travelling = ((Math.sin(light.column * 8 - depth * 5 - time * .5) + 1) * .5) ** 2;
        const balance = readingBalance(light.column);
        const radius = .45 + depth * (light.bright ? 1.3 : .9);
        if (light.bright || travelling > .78) {
          const size = 12 + depth * 28 + shimmer * 4;
          context.globalAlpha = (.16 + depth * .17 + travelling * .16) * balance;
          context.drawImage(glow, x - size / 2, y - size / 2, size, size);
        }
        if (light.flare && depth > .12) {
          const sparkle = ((Math.sin(time * .72 + light.phase) + 1) * .5) ** 5;
          const size = 18 + depth * 18 + sparkle * 12;
          context.globalAlpha = (.13 + sparkle * .32) * balance;
          context.drawImage(flare, x - size / 2, y - size / 2, size, size);
        }
        context.globalAlpha = (.18 + depth * .18 + shimmer * .16 + travelling * .1) * balance;
        context.fillStyle = light.bright ? "#93d7ff" : light.phase % 3 < 1 ? "#359eff" : "#2d6fe8";
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
      // The first small shower arrives at 1.35s, followed by breathing gaps between groups.
      let passing = 0, activeGroup = "none", groupSize = 0;
      if (enabled) {
        const sinceFirst = time - 1.35, cycle = sinceFirst % 60;
        const groupIndex = sinceFirst >= 0 ? ensembles.findIndex(ensemble => cycle >= ensemble.start && cycle < ensemble.start + 3.7) : -1;
        if (groupIndex >= 0) {
          const ensemble = ensembles[groupIndex], mobile = width < 700;
          groupSize = mobile ? ensemble.mobileCount : ensemble.desktopCount;
          activeGroup = `${Math.floor(sinceFirst / 60)}:${groupIndex}`;
          for (let index = 0; index < groupSize; index++) {
            const meteor = ensemble.meteors[index];
            const elapsed = cycle - ensemble.start - meteor.delay;
            if (elapsed <= 0 || elapsed >= meteor.duration) continue;
            const progress = elapsed / meteor.duration;
            const opacity = Math.sin(progress * Math.PI) ** .75 * meteor.strength;
            if (opacity < .04) continue;
            const travelX = width * meteor.distance * (mobile ? 1.65 : 1), travelY = travelX * meteor.slope;
            const distance = Math.hypot(travelX, travelY), directionX = travelX / distance, directionY = travelY / distance;
            const x = width * meteor.entrance - progress * travelX, y = height * meteor.altitude + progress * travelY;
            const length = Math.min(mobile ? 112 : 235, Math.max(mobile ? 62 : 100, width * .135)) * meteor.tail * Math.sin(Math.min(1, progress * 3) * Math.PI / 2);
            const tailX = x + length * directionX, tailY = y - length * directionY;
            const headSize = (mobile ? 24 : 31) * meteor.strength;
            if (x > width + headSize / 2 || tailX < -headSize / 2 || y < -headSize / 2 || tailY > height + headSize / 2) continue;
            passing++;
            const trail = context.createLinearGradient(x, y, tailX, tailY);
            trail.addColorStop(0, "#d8f4ff"); trail.addColorStop(.1, "#8bd8ff"); trail.addColorStop(.42, "#378aff94"); trail.addColorStop(1, "#2467ff00");
            context.lineCap = "round";
            for (const [lineWidth, strength] of [[6, .11], [1.8, .72], [.6, .85]]) {
              context.globalAlpha = opacity * strength; context.strokeStyle = trail; context.lineWidth = lineWidth;
              context.beginPath(); context.moveTo(x, y); context.lineTo(tailX, tailY); context.stroke();
            }
            context.globalAlpha = opacity * .85;
            context.drawImage(glow, x - headSize / 2, y - headSize / 2, headSize, headSize);
          }
        }
      }
      publishMeteors(passing, activeGroup, groupSize);
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
      paintImages();
    }

    function resize() {
      if (!surface || !context) return;
      width = window.innerWidth; height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      surface.width = Math.round(width * ratio); surface.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    }

    function tick(now: number) {
      if (document.hidden || !enabled || disposed) return;
      request = requestAnimationFrame(tick);
      if (now - last < 1000 / 30) return;
      if (previous) time += Math.min((now - previous) / 1000, .1);
      clock.current = time;
      previous = now; last = now;
      draw();
    }

    function visibility() {
      cancelAnimationFrame(request);
      previous = 0; last = 0;
      const running = enabled && !document.hidden;
      if (scene) {
        scene.dataset.motionState = running ? "running" : "paused";
        scene.dataset.frameCount = String(cache.images.length);
        scene.dataset.frameState = !running ? "paused" : cache.images.length ? "ready" : cache.checked ? cache.failed ? "error" : "empty" : "loading";
      }
      if (!document.hidden) { void loadFrames(); if (running) request = requestAnimationFrame(tick); }
      else { pending?.abort(); pending = undefined; }
    }

    resize(); visibility();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true; cancelAnimationFrame(request); pending?.abort();
      window.removeEventListener("resize", resize); document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled]);

  return <div ref={frame} className="starsea-backdrop" aria-hidden="true" data-testid="starsea-backdrop" data-motion-managed data-motion-state="paused" data-frame-state="paused" data-frame-count="0" data-frame-index="0" data-meteor-count="0" data-meteor-group="none" data-meteor-group-size="0">
    <div className="starsea-image-frames">
      <div ref={imageLayerA} className="starsea-frame-layer" data-frame-layer="0" />
      <div ref={imageLayerB} className="starsea-frame-layer" data-frame-layer="1" />
    </div>
    <div className="starsea-blue-horizon" />
    <div className="starsea-light-current" />
    <div className="starsea-stage-shafts" />
    <canvas ref={canvas} className="starsea-audience" />
    <div className="starsea-readability-veil" />
  </div>;
}
