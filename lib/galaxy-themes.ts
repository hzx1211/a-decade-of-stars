import type {EntryKind} from "./types";

export type GalaxyThemeKey = "all" | EntryKind;
export type GalaxyPoint = {radius: number; angle: number; height?: number};
export type GalaxyShape = "spiral" | "rings" | "barred" | "nebula" | "trailing" | "edge-on" | "starburst" | "nebula-v" | "tidal" | "flocculent" | "knotted-ring" | "elliptical";
export type GalaxyTheme = {
  key: GalaxyThemeKey;
  title: string;
  eyebrow: string;
  accent: string;
  secondary: string;
  inclination: number;
  positionAngle: number;
  shape: GalaxyShape;
  arms: number;
  seed: number;
  coreStrength: number;
};

export const galaxyThemes: Record<GalaxyThemeKey, GalaxyTheme> = {
  all: {key: "all", title: "星海旋涡", eyebrow: "A GALAXY OF MEMORIES", accent: "#7dbeff", secondary: "#d3e8ff", inclination: .46, positionAngle: -.28, shape: "spiral", arms: 3, seed: 29092009, coreStrength: 1},
  music: {key: "music", title: "双旋星河", eyebrow: "TWIN SPIRAL", accent: "#8acbff", secondary: "#e1efff", inclination: .67, positionAngle: -.18, shape: "spiral", arms: 2, seed: 1081, coreStrength: .85},
  albums: {key: "albums", title: "光环星系", eyebrow: "RINGS OF SOUND", accent: "#adc9ff", secondary: "#e7e4ff", inclination: .5, positionAngle: .25, shape: "rings", arms: 0, seed: 2083, coreStrength: .65},
  videos: {key: "videos", title: "棒旋星系", eyebrow: "CINEMATIC SPIRAL", accent: "#91c5ff", secondary: "#d9eaff", inclination: .65, positionAngle: -.35, shape: "barred", arms: 2, seed: 3089, coreStrength: .75},
  photos: {key: "photos", title: "蔚蓝星云", eyebrow: "BLUE NEBULA", accent: "#80c9ff", secondary: "#b5b8ef", inclination: .9, positionAngle: -.12, shape: "nebula", arms: 0, seed: 4091, coreStrength: 0},
  journey: {key: "journey", title: "长臂星河", eyebrow: "AN UNENDING ORBIT", accent: "#9dccff", secondary: "#e7f4ff", inclination: .58, positionAngle: -.43, shape: "trailing", arms: 2, seed: 5099, coreStrength: .8},
  timeline: {key: "timeline", title: "侧影星河", eyebrow: "EDGE OF TIME", accent: "#a8d5ff", secondary: "#fff0d8", inclination: .16, positionAngle: -.19, shape: "edge-on", arms: 0, seed: 6101, coreStrength: 1},
  concerts: {key: "concerts", title: "V 字星海", eyebrow: "V STARSEA", accent: "#6cbcff", secondary: "#d5f4ff", inclination: .94, positionAngle: 0, shape: "nebula-v", arms: 0, seed: 7103, coreStrength: 0},
  letters: {key: "letters", title: "双核星桥", eyebrow: "LETTERS BETWEEN STARS", accent: "#a0caff", secondary: "#d8d0ff", inclination: .78, positionAngle: -.22, shape: "tidal", arms: 2, seed: 8107, coreStrength: 0},
  journal: {key: "journal", title: "絮羽星云", eyebrow: "FRAGMENTS OF DAYS", accent: "#91c6ee", secondary: "#cbd4f5", inclination: .82, positionAngle: .12, shape: "flocculent", arms: 0, seed: 9109, coreStrength: .25},
  milestones: {key: "milestones", title: "星环坐标", eyebrow: "MOMENTS IN ORBIT", accent: "#9dcfff", secondary: "#f1e7cd", inclination: .78, positionAngle: -.12, shape: "knotted-ring", arms: 0, seed: 10111, coreStrength: .1},
  "memory-book": {key: "memory-book", title: "银辉星团", eyebrow: "A CONSTELLATION OF YEARS", accent: "#b9d6ff", secondary: "#f7ead4", inclination: .84, positionAngle: -.38, shape: "elliptical", arms: 0, seed: 11113, coreStrength: 1},
};

export function getGalaxyTheme(key: string): GalaxyTheme {
  return Object.prototype.hasOwnProperty.call(galaxyThemes, key) ? galaxyThemes[key as GalaxyThemeKey] : galaxyThemes.all;
}

const TAU = Math.PI * 2;
const polar = (radius: number, angle: number) => ({x: Math.cos(angle) * radius, y: Math.sin(angle) * radius});
const normal = (random: () => number) => Math.sqrt(-2 * Math.log(Math.max(.00001, random()))) * Math.cos(TAU * random());
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

type NebulaVArm = -1 | 1;

/** A loose, slightly curved guide for two nebula streams, never the archive logo geometry. */
export function getNebulaVArmCenter(arm: NebulaVArm, progress: number) {
  const t = clamp(progress, 0, 1);
  const bend = Math.sin(t * Math.PI);
  const x = arm * (.79 - t * .735 + bend * .035);
  const y = -.66 + t * 1.38 + arm * Math.sin((t + .15) * Math.PI * 1.3) * .018;
  const dx = arm * (-.735 + Math.cos(t * Math.PI) * Math.PI * .035);
  const dy = 1.38 + arm * Math.cos((t + .15) * Math.PI * 1.3) * Math.PI * 1.3 * .018;
  const length = Math.hypot(dx, dy);
  return {x, y, tangentX: dx / length, tangentY: dy / length, normalX: -dy / length, normalY: dx / length};
}

/** Samples blue gas around a soft V guide so its edges can dissolve into space. */
export function sampleNebulaVPoint(index: number, random: () => number, spread = 1) {
  const arm: NebulaVArm = index % 2 ? 1 : -1;
  const initial = Math.pow(random(), .82);
  const progress = clamp(initial + normal(random) * .032 * spread, .035, .965);
  const guide = getNebulaVArmCenter(arm, progress);
  const coreWidth = (.06 + Math.sin(progress * Math.PI) * .052 + (1 - progress) * .022) * spread;
  const lateral = clamp(normal(random) * coreWidth, -coreWidth * 2.45, coreWidth * 2.45);
  const along = clamp(normal(random) * .018 * spread, -.052, .052);
  return {
    x: guide.x + guide.normalX * lateral + guide.tangentX * along,
    y: guide.y + guide.normalY * lateral + guide.tangentY * along,
  };
}

/** Disk-plane matter in units of the shared 455 px radius. No browser or data access. */
export function sampleGalaxyMatter(theme: GalaxyTheme, index: number, random: () => number, spread = 1): {x: number; y: number} {
  if (theme.shape === "nebula-v") return sampleNebulaVPoint(index, random, spread);
  const u = random();
  const angle = random() * TAU;
  const noise = normal(random);
  switch (theme.shape) {
    case "spiral": {
      const radius = .055 + Math.pow(u, .72) * .96;
      return polar(radius + normal(random) * .024 * spread, index % theme.arms * TAU / theme.arms + 2.3 * Math.log(radius + .055) - .5 + noise * .085 * spread);
    }
    case "rings": {
      const ring = [.32, .57, .84][index % 3];
      const ripple = Math.sin(angle * 3 + ring * 4) * .021 + Math.sin(angle * 7 - ring * 3) * .012;
      return polar(ring + ripple + noise * .034 * spread, angle);
    }
    case "barred": {
      if (index % 4 === 0) return {x: (u - .5) * 1.12, y: noise * .043 * spread};
      const radius = .37 + Math.pow(u, .7) * .64;
      return polar(radius + normal(random) * .02 * spread, index % 2 * Math.PI + (radius - .37) * 5 + noise * .07 * spread);
    }
    case "nebula": {
      const t = (u - .5) * 2;
      const width = .08 + Math.abs(t) * .16;
      return {x: t * .83 + noise * .055 * spread, y: Math.sin(t * 4.1) * .25 + normal(random) * width * spread};
    }
    case "trailing": {
      const radius = .04 + Math.pow(u, .74) * 1.01;
      return polar(radius + normal(random) * .022 * spread, index % 2 * Math.PI + 3.5 * Math.log(radius + .07) + noise * .06 * spread);
    }
    case "edge-on": {
      const radius = Math.sqrt(u) * .98;
      return polar(radius, angle + noise * .02 * spread);
    }
    case "starburst": {
      const branch = index % 11;
      const radius = Math.pow(u, .9) * (.7 + .26 * (.5 + Math.sin(branch * 4.1 + 1) * .5));
      const ray = branch * TAU / 11 + Math.sin(branch * 2.4) * .14;
      return polar(radius + normal(random) * .025, ray + .2 * Math.sin(radius * 5 + ray) + noise * (.035 + radius * .085) * spread);
    }
    case "tidal": {
      if (index % 5 === 0) {
        const t = (u - .5) * 2;
        return {x: t * .48, y: Math.sin(t * 2.8) * .16 + noise * .035 * spread};
      }
      const side = index % 2 ? 1 : -1;
      const radius = Math.pow(u, .85) * .47;
      const theta = angle + 2.1 * Math.log(radius + .08);
      return {x: side * .42 + Math.cos(theta) * radius, y: side * .08 + Math.sin(theta) * radius * .84};
    }
    case "flocculent": {
      const cloud = index % 13;
      const cloudAngle = cloud * 2.399963;
      const cloudRadius = .2 + (cloud * .137 % .7);
      return {x: Math.cos(cloudAngle) * cloudRadius + noise * .075 * spread, y: Math.sin(cloudAngle) * cloudRadius * .8 + normal(random) * .11 * spread};
    }
    case "knotted-ring": {
      const theta = index % 4 === 0 ? index % 9 * TAU / 9 + noise * .065 * spread : angle;
      return polar(.73 + noise * .037 * spread + .04 * Math.sin(theta * 3), theta);
    }
    case "elliptical": {
      const radius = Math.min(1, -Math.log(Math.max(.00001, u)) * .25);
      return {x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * .68};
    }
  }
}

/** Record markers follow each astronomical silhouette while keeping the old all layout. */
export function getGalaxyRecordPoint(theme: GalaxyThemeKey, index: number, layout: number): GalaxyPoint {
  const config = getGalaxyTheme(theme);
  const fraction = (index * .618034 + layout * .137) % 1;
  const radius = .34 + fraction * .62;
  const height = Math.sin(index * 4.7) * 4;
  switch (config.shape) {
    case "nebula-v": {
      const pair = Math.floor(index / 2);
      const arm: NebulaVArm = index % 2 ? 1 : -1;
      const progress = .12 + ((pair * .61803398875 + layout * .137 + .19) % 1) * .72;
      const guide = getNebulaVArmCenter(arm, progress);
      const drift = Math.sin(pair * 4.7 + layout * 1.9) * (.012 + Math.sin(progress * Math.PI) * .022);
      const point = {
        x: guide.x + guide.normalX * drift,
        y: guide.y + guide.normalY * drift,
      };
      return {radius: Math.hypot(point.x, point.y), angle: Math.atan2(point.y, point.x), height: 0};
    }
    case "spiral": return {radius, angle: index % config.arms * TAU / config.arms + 2.3 * Math.log(radius + .055) - .5, height};
    case "rings": {
      const ring = [.32, .57, .84][index % 3];
      const angle = index * 2.399963 + layout * .41;
      return {radius: ring + Math.sin(angle * 3 + ring * 4) * .021 + Math.sin(angle * 7 - ring * 3) * .012, angle, height};
    }
    case "barred": return {radius: .4 + fraction * .54, angle: index % 2 * Math.PI + fraction * 2.7, height};
    case "trailing": return {radius, angle: index % 2 * Math.PI + 3.5 * Math.log(radius + .07), height};
    case "edge-on": return {radius: .2 + fraction * .75, angle: index * 2.399963 + layout * .31, height: Math.sin(index * 2.3) * 9};
    case "starburst": {
      const branch = index % 11;
      const radius = .25 + fraction * (.4 + .22 * (.5 + Math.sin(branch * 4.1 + 1) * .5));
      const ray = branch * TAU / 11 + Math.sin(branch * 2.4) * .14;
      return {radius, angle: ray + .2 * Math.sin(radius * 5 + ray), height};
    }
    case "knotted-ring": return {radius: .69 + Math.floor(index / 9) % 3 * .045 + .04 * Math.sin(index % 9 * TAU / 9 * 3), angle: index * TAU / 9 + Math.floor(index / 9) * .14 + layout * .12, height};
    default: {
      let state = (config.seed + index * 8039 + layout * 1013) >>> 0;
      const random = () => {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296;};
      const p = sampleGalaxyMatter(config, index, random, .4);
      const distance = Math.hypot(p.x, p.y);
      const minimum = config.shape === "elliptical" ? .17 : .08;
      return {radius: Math.max(minimum, distance), angle: Math.atan2(p.y, p.x), height};
    }
  }
}
