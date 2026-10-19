"use client";

import { useEffect, useRef } from "react";
import {getGalaxyRecordPoint, getGalaxyTheme, sampleGalaxyMatter, type GalaxyPoint, type GalaxyTheme, type GalaxyThemeKey} from "@/lib/galaxy-themes";

export type {GalaxyPoint} from "@/lib/galaxy-themes";

const TAU = Math.PI * 2;
const VIEW_WIDTH = 1200;
const VIEW_HEIGHT = 760;
const DISK_RADIUS = 455;
const INCLINATION = 0.46;
const POSITION_ANGLE = -0.28;
const CENTER_Y = 392;

export type GalaxyProjection = {
  /** Radians, including the slow movement reported by onFrame. */
  rotation: number;
  zoom: number;
  width?: number;
  height?: number;
  inclination?: number;
  positionAngle?: number;
};

/** Shared by the painted disk and the accessible, interactive record markers. */
export function projectGalaxyPoint(point: GalaxyPoint, projection: GalaxyProjection) {
  const radius = point.radius * DISK_RADIUS;
  const angle = point.angle + projection.rotation;
  const diskX = Math.cos(angle) * radius;
  const depth = Math.sin(angle);
  const diskY = Math.sin(angle) * radius * (projection.inclination ?? INCLINATION) - (point.height ?? 0);
  const cosine = Math.cos(projection.positionAngle ?? POSITION_ANGLE);
  const sine = Math.sin(projection.positionAngle ?? POSITION_ANGLE);
  const zoom = Math.min(1.7, Math.max(0.65, projection.zoom));
  return {
    x: (VIEW_WIDTH / 2 + (diskX * cosine - diskY * sine) * zoom) * (projection.width ?? VIEW_WIDTH) / VIEW_WIDTH,
    y: (CENTER_Y + (diskX * sine + diskY * cosine) * zoom) * (projection.height ?? VIEW_HEIGHT) / VIEW_HEIGHT,
    depth,
    scale: 0.88 + (depth + 1) * 0.1,
  };
}

type GalaxySceneProps = {
  animated: boolean;
  rotation: number;
  zoom: number;
  theme?: GalaxyThemeKey;
  motionEnabled?: boolean;
  onFrame?: (projection: GalaxyProjection) => void;
};

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = Math.imul(value ^ value >>> 15, 1 | value);
    result ^= result + Math.imul(result ^ result >>> 7, 61 | result);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number) {
  return Math.sqrt(-2 * Math.log(Math.max(0.00001, random()))) * Math.cos(TAU * random());
}

function lightBrush(color: string, size = 96) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `${color}d9`);
  gradient.addColorStop(0.16, `${color}80`);
  gradient.addColorStop(0.45, `${color}28`);
  gradient.addColorStop(1, `${color}00`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return canvas;
}

/** Expensive star formation is cached once; animation only projects this texture. */
function createOriginalGalaxyTexture() {
  const texture = document.createElement("canvas");
  texture.width = texture.height = 1536;
  const context = texture.getContext("2d");
  if (!context) return texture;
  context.scale(1536 / 1200, 1536 / 1200);
  context.translate(600, 600);
  const random = seededRandom(29092009);
  const blueMist = lightBrush("#7dbeff");
  const whiteMist = lightBrush("#d3e8ff");
  const violetMist = lightBrush("#8d9cdd");
  const darkMist = lightBrush("#020711");

  const halo = context.createRadialGradient(0, 0, 0, 0, 0, 545);
  halo.addColorStop(0, "#b3cfff24");
  halo.addColorStop(0.3, "#668dc414");
  halo.addColorStop(0.7, "#4d80ce09");
  halo.addColorStop(1, "#20549a00");
  context.fillStyle = halo;
  context.fillRect(-600, -600, 1200, 1200);

  // Irregular, overlapping clouds avoid clean rings or diagram-like spiral arms.
  context.globalCompositeOperation = "screen";
  for (let index = 0; index < 2100; index++) {
    const arm = index % 3;
    const unit = 0.055 + Math.pow(random(), 0.72) * 0.97;
    const angle = arm * TAU / 3 + 2.3 * Math.log(unit + 0.055) - 0.5 + gaussian(random) * 0.085;
    const radius = unit * DISK_RADIUS + gaussian(random) * (8 + unit * 15);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const size = 32 + random() * 58 + unit * 15;
    const edge = Math.max(0, 1 - Math.pow(unit, 3));
    context.globalAlpha = (0.055 + random() * 0.15) * edge;
    context.drawImage(index % 11 === 0 ? violetMist : index % 3 === 0 ? whiteMist : blueMist, x - size / 2, y - size / 2, size, size);
  }

  // Narrow dark clouds cross the luminous arms, like interstellar dust lanes.
  context.globalCompositeOperation = "source-over";
  for (let index = 0; index < 1250; index++) {
    const unit = 0.12 + random() * 0.86;
    const angle = index % 3 * TAU / 3 + 2.3 * Math.log(unit + 0.055) - 0.38 + gaussian(random) * 0.035;
    const radius = unit * DISK_RADIUS + gaussian(random) * 7;
    const size = 16 + random() * 35;
    context.globalAlpha = 0.12 + random() * 0.27;
    context.drawImage(darkMist, Math.cos(angle) * radius - size / 2, Math.sin(angle) * radius - size / 2, size, size);
  }

  context.globalCompositeOperation = "screen";
  const starColors = ["#d6e9ff", "#9dcbff", "#b5d8ff", "#edf6ff", "#c8d2ef"];
  for (let index = 0; index < 38000; index++) {
    const unit = Math.pow(random(), 0.69);
    const spiral = random() < 0.85;
    const angle = spiral
      ? index % 3 * TAU / 3 + 2.3 * Math.log(unit + 0.055) - 0.5 + gaussian(random) * (0.04 + 0.065 / (unit + 0.2))
      : random() * TAU;
    const radius = unit * DISK_RADIUS + gaussian(random) * (spiral ? 9 : 18);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const size = 0.26 + Math.pow(random(), 4) * 1.15;
    const edge = Math.max(0, 1 - Math.pow(unit, 5));
    context.globalAlpha = (0.16 + random() * 0.6) * edge * (spiral ? 1 : 0.5);
    context.fillStyle = unit < 0.19 ? "#fff2dc" : starColors[index % starColors.length];
    context.fillRect(x, y, size, size);
    if (index % 367 === 0 && unit > 0.3) {
      context.globalAlpha = 0.35 * edge;
      context.drawImage(whiteMist, x - 6, y - 6, 12, 12);
    }
  }

  // The bulge contains older, warmer stars beneath the blue star-forming arms.
  context.globalAlpha = 1;
  const bulge = context.createRadialGradient(0, 0, 0, 0, 0, 148);
  bulge.addColorStop(0, "#fffbeaef");
  bulge.addColorStop(0.07, "#fff2d9cf");
  bulge.addColorStop(0.22, "#f3dcbd83");
  bulge.addColorStop(0.48, "#b6b8d438");
  bulge.addColorStop(1, "#a7b9de00");
  context.fillStyle = bulge;
  context.fillRect(-148, -148, 296, 296);
  for (let index = 0; index < 8500; index++) {
    const radius = Math.min(145, -Math.log(Math.max(0.00001, random())) * 27);
    const angle = random() * TAU;
    context.globalAlpha = (1 - radius / 160) * (0.1 + random() * 0.45);
    context.fillStyle = index % 5 ? "#ffefd4" : "#eaf3ff";
    context.fillRect(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.55, 0.55);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  return texture;
}

/** Two unbounded clouds follow a V route; their dissolved edges deliberately avoid a logo outline. */
function createNebulaVTexture(theme: GalaxyTheme) {
  const texture = document.createElement("canvas");
  texture.width = texture.height = 1536;
  const context = texture.getContext("2d");
  if (!context) return texture;
  context.scale(1536 / 1200, 1536 / 1200);
  context.translate(600, 600);
  const random = seededRandom(theme.seed);
  const blueMist = lightBrush("#287aff");
  const iceMist = lightBrush("#afe6ff");
  const violetMist = lightBrush("#708dff");
  const darkMist = lightBrush("#020817");

  // The wide, overlapping gas patches give each arm its own drifting cloud texture.
  context.globalCompositeOperation = "screen";
  for (let index = 0; index < 1850; index++) {
    const point = sampleGalaxyMatter(theme, index, random, 1.26);
    const size = 36 + random() * 92;
    context.globalAlpha = .028 + random() * .115;
    const brush = index % 13 === 0 ? violetMist : index % 5 === 0 ? iceMist : blueMist;
    context.drawImage(brush, point.x * DISK_RADIUS - size / 2, point.y * DISK_RADIUS - size / 2, size, size);
  }

  // Darker gas breaks the brightness into natural lanes without drawing a hard edge.
  context.globalCompositeOperation = "source-over";
  for (let index = 0; index < 680; index++) {
    const point = sampleGalaxyMatter(theme, index, random, .82);
    const size = 16 + random() * 44;
    context.globalAlpha = .09 + random() * .24;
    context.drawImage(darkMist, point.x * DISK_RADIUS - size / 2 + 7, point.y * DISK_RADIUS - size / 2 - 5, size, size);
  }

  context.globalCompositeOperation = "screen";
  for (let index = 0; index < 34000; index++) {
    const point = sampleGalaxyMatter(theme, index, random, .9);
    const x = point.x * DISK_RADIUS;
    const y = point.y * DISK_RADIUS;
    const size = .25 + Math.pow(random(), 4) * 1.12;
    context.globalAlpha = .14 + random() * .67;
    context.fillStyle = index % 11 === 0 ? "#f0faff" : index % 3 === 0 ? "#a5dcff" : "#4f9eff";
    context.fillRect(x, y, size, size);
    if (index % 283 === 0) {
      const flare = 10 + random() * 12;
      context.globalAlpha = .19 + random() * .19;
      context.drawImage(iceMist, x - flare / 2, y - flare / 2, flare, flare);
    }
  }

  // A few diffuse nurseries connect the two streams at the V's lower meeting point.
  context.globalCompositeOperation = "screen";
  for (let index = 0; index < 26; index++) {
    const point = sampleGalaxyMatter(theme, index + 180, random, .32);
    const size = 18 + random() * 34;
    context.globalAlpha = .18 + random() * .24;
    context.drawImage(index % 4 === 0 ? iceMist : blueMist, point.x * DISK_RADIUS - size / 2, point.y * DISK_RADIUS - size / 2, size, size);
  }
  for (let index = 0; index < 12; index++) {
    const point = getGalaxyRecordPoint("concerts", index, 0);
    const x = Math.cos(point.angle) * point.radius * DISK_RADIUS;
    const y = Math.sin(point.angle) * point.radius * DISK_RADIUS;
    context.globalAlpha = .22;
    context.drawImage(iceMist, x - 10, y - 10, 20, 20);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  blueMist.width = blueMist.height = iceMist.width = iceMist.height = violetMist.width = violetMist.height = darkMist.width = darkMist.height = 1;
  return texture;
}

function createGalaxyTexture(theme: GalaxyTheme) {
  if (theme.key === "all") return createOriginalGalaxyTexture();
  if (theme.shape === "nebula-v") return createNebulaVTexture(theme);
  const texture = document.createElement("canvas");
  texture.width = texture.height = 1536;
  const context = texture.getContext("2d");
  if (!context) return texture;
  context.scale(1536 / 1200, 1536 / 1200);
  context.translate(600, 600);
  const random = seededRandom(theme.seed);
  const blueMist = lightBrush(theme.accent);
  const whiteMist = lightBrush(theme.secondary);
  const darkMist = lightBrush("#020711");
  const warmMist = lightBrush("#ffefd5");

  const cloudCount = theme.shape === "elliptical" ? 950 : 2200;
  context.globalCompositeOperation = "screen";
  for (let index = 0; index < cloudCount; index++) {
    const matter = sampleGalaxyMatter(theme, index, random, 1.35);
    const distance = Math.hypot(matter.x, matter.y);
    const edge = Math.max(0, 1 - Math.pow(distance / 1.17, 5));
    const size = (theme.shape === "nebula" || theme.shape === "flocculent" ? 52 : 30) + random() * 62;
    context.globalAlpha = (.055 + random() * .14) * edge;
    const brush = index % 4 === 0 ? whiteMist : blueMist;
    context.drawImage(brush, matter.x * DISK_RADIUS - size / 2, matter.y * DISK_RADIUS - size / 2, size, size);
  }

  if (!["elliptical", "rings", "knotted-ring"].includes(theme.shape)) {
    context.globalCompositeOperation = "source-over";
    for (let index = 0; index < 1000; index++) {
      const matter = sampleGalaxyMatter(theme, index, random, .8);
      const size = 18 + random() * 36;
      context.globalAlpha = .1 + random() * .25;
      context.drawImage(darkMist, matter.x * DISK_RADIUS - size / 2 + 9, matter.y * DISK_RADIUS - size / 2 - 8, size, size);
    }
  }

  context.globalCompositeOperation = "screen";
  const starCount = theme.shape === "elliptical" ? 44000 : 36000;
  for (let index = 0; index < starCount; index++) {
    const matter = sampleGalaxyMatter(theme, index, random, .8);
    const distance = Math.hypot(matter.x, matter.y);
    const edge = Math.max(0, 1 - Math.pow(distance / 1.14, 6));
    const size = .24 + Math.pow(random(), 4) * 1.12;
    context.globalAlpha = (.13 + random() * .57) * edge;
    context.fillStyle = index % 9 === 0 ? theme.secondary : index % 3 === 0 ? "#e7f4ff" : theme.accent;
    context.fillRect(matter.x * DISK_RADIUS, matter.y * DISK_RADIUS, size, size);
    if (index % 389 === 0) {
      context.globalAlpha = .2 * edge;
      context.drawImage(whiteMist, matter.x * DISK_RADIUS - 6, matter.y * DISK_RADIUS - 6, 12, 12);
    }
  }

  function nucleus(x: number, y: number, radius: number, strength: number) {
    if (!context) return;
    const core = context.createRadialGradient(x, y, 0, x, y, radius);
    core.addColorStop(0, "#fffbeaef");
    core.addColorStop(.08, "#fff2d9cf");
    core.addColorStop(.24, "#e5e8f583");
    core.addColorStop(.5, "#b6c8e438");
    core.addColorStop(1, "#a7b9de00");
    context.globalAlpha = strength;
    context.fillStyle = core;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  if (theme.shape === "tidal") {
    nucleus(-.42 * DISK_RADIUS, -.08 * DISK_RADIUS, 84, 1);
    nucleus(.42 * DISK_RADIUS, .08 * DISK_RADIUS, 94, 1);
  } else if (theme.coreStrength) {
    nucleus(0, 0, theme.shape === "elliptical" ? 185 : 132, theme.coreStrength);
  }

  if (theme.shape === "knotted-ring") {
    for (let index = 0; index < 9; index++) {
      const angle = index * TAU / 9;
      const radius = (.73 + .04 * Math.sin(angle * 3)) * DISK_RADIUS;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      context.globalAlpha = .6;
      context.drawImage(index % 3 === 0 ? warmMist : whiteMist, x - 38, y - 38, 76, 76);
      context.globalAlpha = .8;
      context.fillStyle = "#eff7ff";
      context.beginPath(); context.arc(x, y, 1.3, 0, TAU); context.fill();
    }
  }
  if (theme.shape === "edge-on") {
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = .8;
    context.drawImage(darkMist, -430, 6, 860, 65);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  blueMist.width = blueMist.height = whiteMist.width = whiteMist.height = darkMist.width = darkMist.height = warmMist.width = warmMist.height = 1;
  return texture;
}

const easeTransition = (value: number) => value * value * (3 - 2 * value);

/** A procedural astronomical image; all story nodes remain real DOM controls. */
export function GalaxyScene({ animated, rotation, zoom, theme = "all", motionEnabled = animated, onFrame }: GalaxySceneProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controls = useRef({ animated, rotation, zoom, theme, motionEnabled, onFrame });
  const refresh = useRef<(() => void) | null>(null);

  useEffect(() => {
    controls.current = { animated, rotation, zoom, theme, motionEnabled, onFrame };
    refresh.current?.();
  }, [animated, rotation, zoom, theme, motionEnabled, onFrame]);

  useEffect(() => {
    const surface = canvas.current;
    const context = surface?.getContext("2d", { alpha: true });
    if (!surface || !context) return;
    let activeTheme = getGalaxyTheme(controls.current.theme);
    let texture = createGalaxyTexture(activeTheme);
    let upcoming: HTMLCanvasElement | null = null;
    let progress = 1;
    let fromView = {inclination: activeTheme.inclination, positionAngle: activeTheme.positionAngle, coreStrength: activeTheme.coreStrength, vBlend: activeTheme.shape === "nebula-v" ? 1 : 0};
    let toView = {...fromView};
    const starGlow = lightBrush("#bddfff");
    const random = seededRandom(200917);
    const stars = Array.from({ length: 230 }, (_, index) => ({
      x: random() * VIEW_WIDTH,
      y: random() * VIEW_HEIGHT,
      radius: index % 29 === 0 ? 1.15 : 0.24 + random() * 0.55,
      opacity: 0.17 + random() * 0.57,
      phase: random() * TAU,
    }));
    const flickers = Array.from({ length: 34 }, () => ({
      phase: random() * TAU,
      strength: 0.15 + random() * 0.26,
    }));
    let frame = 0;
    let previous = 0;
    let lastPaint = 0;
    let elapsed = 0;
    let visible = true;
    let disposed = false;
    let pixelRatio = 1;
    let renderWidth = 0;
    let renderHeight = 0;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

    function view() {
      const mix = easeTransition(progress);
      return {
        inclination: fromView.inclination + (toView.inclination - fromView.inclination) * mix,
        positionAngle: fromView.positionAngle + (toView.positionAngle - fromView.positionAngle) * mix,
        coreStrength: fromView.coreStrength + (toView.coreStrength - fromView.coreStrength) * mix,
        vBlend: fromView.vBlend + (toView.vBlend - fromView.vBlend) * mix,
      };
    }

    function finishTransition() {
      if (upcoming) {
        texture.width = texture.height = 1;
        texture = upcoming;
        upcoming = null;
      }
      progress = 1;
      fromView = {...toView};
      surface?.setAttribute("data-galaxy-transition", "idle");
    }

    function syncTheme() {
      const next = getGalaxyTheme(controls.current.theme);
      const allowTransition = controls.current.motionEnabled && !motionPreference.matches;
      if (next.key !== activeTheme.key) {
        const previousView = view();
        // A quick second selection preserves the current mixed image, not three textures.
        if (upcoming) {
          const mixed = document.createElement("canvas");
          mixed.width = mixed.height = 1536;
          const mixedContext = mixed.getContext("2d");
          if (mixedContext) {
            const blend = easeTransition(progress);
            mixedContext.globalAlpha = 1 - blend;
            mixedContext.drawImage(texture, 0, 0);
            mixedContext.globalCompositeOperation = "lighter";
            mixedContext.globalAlpha = blend;
            mixedContext.drawImage(upcoming, 0, 0);
          }
          texture.width = texture.height = upcoming.width = upcoming.height = 1;
          texture = mixed;
          upcoming = null;
        }
        activeTheme = next;
        fromView = previousView;
        toView = {inclination: next.inclination, positionAngle: next.positionAngle, coreStrength: next.coreStrength, vBlend: next.shape === "nebula-v" ? 1 : 0};
        upcoming = createGalaxyTexture(next);
        progress = 0;
        surface?.setAttribute("data-galaxy-theme", next.key);
        surface?.setAttribute("data-galaxy-transition", "running");
      }
      if (!allowTransition && upcoming) finishTransition();
    }

    function running() {
      return !disposed && visible && !document.hidden && !motionPreference.matches && (controls.current.animated || Boolean(upcoming && controls.current.motionEnabled));
    }

    function paint() {
      if (!context || !surface || !renderWidth || !renderHeight) return;
      const active = controls.current;
      const currentView = view();
      const sceneZoom = Math.min(1.7, Math.max(0.65, active.zoom));
      // A small angular drift keeps the cloud V readable while allowing manual rotation.
      const sceneRotation = active.rotation + elapsed * .007 * (1 - currentView.vBlend) + Math.sin(elapsed * .07) * .035 * currentView.vBlend;
      context.setTransform(pixelRatio * renderWidth / VIEW_WIDTH, 0, 0, pixelRatio * renderHeight / VIEW_HEIGHT, 0, 0);
      context.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

      const deepSpace = context.createRadialGradient(620, 400, 30, 600, 380, 640);
      deepSpace.addColorStop(0, "#0a163bb0");
      deepSpace.addColorStop(0.52, "#040c22ac");
      deepSpace.addColorStop(1, "#020611df");
      context.fillStyle = deepSpace;
      context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

      for (const star of stars) {
        const shimmer = 0.84 + Math.sin(elapsed * 0.68 + star.phase) * 0.16;
        context.globalAlpha = star.opacity * shimmer;
        context.fillStyle = "#c4dbff";
        context.beginPath();
        context.arc(star.x, star.y, star.radius, 0, TAU);
        context.fill();
        if (star.radius > 1) {
          context.globalAlpha *= 0.35;
          context.drawImage(starGlow, star.x - 10, star.y - 10, 20, 20);
        }
      }
      context.globalAlpha = 1;

      context.save();
      context.translate(VIEW_WIDTH / 2, CENTER_Y);
      context.rotate(currentView.positionAngle);
      context.scale(sceneZoom, sceneZoom * currentView.inclination);
      context.rotate(sceneRotation);
      const blend = upcoming ? easeTransition(progress) : 0;
      context.globalAlpha = 1 - blend;
      context.drawImage(texture, -600, -600, 1200, 1200);
      if (upcoming) {
        context.globalCompositeOperation = "screen";
        context.globalAlpha = blend;
        context.drawImage(upcoming, -600, -600, 1200, 1200);
      }
      context.restore();

      // A rounder nucleus sits above the thin disk instead of becoming a flat stripe.
      context.save();
      context.translate(VIEW_WIDTH / 2, CENTER_Y);
      context.rotate(currentView.positionAngle);
      context.scale(sceneZoom, sceneZoom * (.45 + currentView.inclination * .55));
      const core = context.createRadialGradient(0, 0, 0, 0, 0, 76);
      core.addColorStop(0, "#fffef6d9");
      core.addColorStop(0.12, "#fff3da9c");
      core.addColorStop(0.4, "#dfe7ff35");
      core.addColorStop(1, "#adc8ff00");
      context.globalCompositeOperation = "screen";
      context.globalAlpha = currentView.coreStrength;
      context.fillStyle = core;
      context.fillRect(-76, -76, 152, 152);
      context.restore();

      context.globalCompositeOperation = "screen";
      for (const [index, star] of flickers.entries()) {
        const point = projectGalaxyPoint(getGalaxyRecordPoint(activeTheme.key, index, 0), { rotation: sceneRotation, zoom: sceneZoom, ...currentView });
        const shimmer = Math.pow((Math.sin(elapsed * 0.5 + star.phase) + 1) / 2, 3);
        context.globalAlpha = star.strength * (0.3 + shimmer * 0.7) * (upcoming ? Math.abs(blend - .5) * 2 : 1);
        const size = 7 + shimmer * 6;
        context.drawImage(starGlow, point.x - size / 2, point.y - size / 2, size, size);
      }
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
      active.onFrame?.({ rotation: sceneRotation, zoom: sceneZoom, width: VIEW_WIDTH, height: VIEW_HEIGHT, inclination: currentView.inclination, positionAngle: currentView.positionAngle });
    }

    function tick(now: number) {
      frame = 0;
      if (!running()) { previous = 0; return; }
      const delta = previous ? Math.min((now - previous) / 1000, .1) : 0;
      previous = now;
      if (controls.current.animated) elapsed += delta;
      if (upcoming) {
        progress = Math.min(1, progress + delta / .82);
        if (progress >= 1) finishTransition();
      }
      if (!lastPaint || now - lastPaint >= 1000 / 30 - 1 || !running()) {
        lastPaint = now;
        paint();
      }
      if (running()) frame = window.requestAnimationFrame(tick);
      else previous = 0;
    }

    function update() {
      if (disposed) return;
      syncTheme();
      paint();
      if (running()) {
        if (!frame) frame = window.requestAnimationFrame(tick);
      } else {
        window.cancelAnimationFrame(frame);
        frame = 0;
        previous = 0;
        lastPaint = 0;
      }
    }

    function resize() {
      if (!surface) return;
      const bounds = surface.getBoundingClientRect();
      renderWidth = bounds.width;
      renderHeight = bounds.height;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
      const nextWidth = Math.max(1, Math.round(renderWidth * pixelRatio));
      const nextHeight = Math.max(1, Math.round(renderHeight * pixelRatio));
      if (surface.width !== nextWidth || surface.height !== nextHeight) {
        surface.width = nextWidth;
        surface.height = nextHeight;
      }
      update();
    }

    refresh.current = update;
    surface.setAttribute("data-galaxy-theme", activeTheme.key);
    surface.setAttribute("data-galaxy-transition", "idle");
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(surface);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    }, { threshold: 0 });
    visibilityObserver.observe(surface);
    document.addEventListener("visibilitychange", update);
    motionPreference.addEventListener("change", update);
    resize();

    return () => {
      disposed = true;
      refresh.current = null;
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", update);
      motionPreference.removeEventListener("change", update);
      texture.width = texture.height = 1;
      if (upcoming) upcoming.width = upcoming.height = 1;
      starGlow.width = starGlow.height = 1;
    };
  }, []);

  return <canvas ref={canvas} className="galaxy-scene" aria-hidden="true" data-galaxy-scene="true" data-motion-managed="true" style={{ display: "block", width: "100%", height: "100%", pointerEvents: "none" }} />;
}
