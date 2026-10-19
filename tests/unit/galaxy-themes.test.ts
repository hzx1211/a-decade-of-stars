import {describe, expect, it} from "vitest";
import {entryKinds} from "../../lib/types";
import {galaxyThemes, getGalaxyRecordPoint, getGalaxyTheme, type GalaxyThemeKey} from "../../lib/galaxy-themes";

const themeKeys: GalaxyThemeKey[] = ["all", ...entryKinds];

describe("galaxy themes and record placement", () => {
  it("defines a complete, finite theme for the all view and every saved record type", () => {
    expect(Object.keys(galaxyThemes).sort()).toEqual(themeKeys.slice().sort());

    for (const key of themeKeys) {
      const theme = getGalaxyTheme(key);
      expect(theme.key).toBe(key);
      expect(theme.title.trim().length).toBeGreaterThan(0);
      expect(theme.eyebrow.trim().length).toBeGreaterThan(0);
      expect(theme.accent).not.toBe(theme.secondary);
      expect(Number.isFinite(theme.inclination)).toBe(true);
      expect(theme.inclination).toBeGreaterThan(0);
      expect(theme.inclination).toBeLessThanOrEqual(1);
      expect(Number.isFinite(theme.positionAngle)).toBe(true);
      expect(Math.abs(theme.positionAngle)).toBeLessThanOrEqual(Math.PI);
    }
  });

  it("falls back safely for unknown filter values", () => {
    expect(getGalaxyTheme("invalid-kind")).toEqual(getGalaxyTheme("all"));
    expect(getGalaxyTheme("")).toEqual(getGalaxyTheme("all"));
  });

  it("gives every record type its own deterministic spatial distribution", () => {
    const signatures = entryKinds.map(kind => {
      const points = Array.from({length: 18}, (_, index) => getGalaxyRecordPoint(kind, index, 0));
      for (const point of points) {
        expect(Number.isFinite(point.radius) && point.radius > 0 && point.radius <= 1.2).toBe(true);
        expect(Number.isFinite(point.angle)).toBe(true);
        expect(Number.isFinite(point.height ?? 0)).toBe(true);
      }
      expect(getGalaxyRecordPoint(kind, 7, 0)).toEqual(getGalaxyRecordPoint(kind, 7, 0));
      return JSON.stringify(points.map(point => [point.radius, point.angle, point.height ?? 0]));
    });

    expect(new Set(signatures).size).toBe(entryKinds.length);
  });

  it("changes the placement when a new layout is requested for every theme", () => {
    for (const key of themeKeys) {
      const initial = Array.from({length: 12}, (_, index) => getGalaxyRecordPoint(key, index, 0));
      const relaid = Array.from({length: 12}, (_, index) => getGalaxyRecordPoint(key, index, 1));
      const moved = initial.filter((point, index) => {
        const next = relaid[index];
        return Math.abs(point.radius - next.radius) > 1e-6
          || Math.abs(point.angle - next.angle) > 1e-6
          || Math.abs((point.height ?? 0) - (next.height ?? 0)) > 1e-6;
      }).length;
      expect(moved, `${key} did not produce a new arrangement`).toBeGreaterThanOrEqual(6);
    }
  });
});
