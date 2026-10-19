import {describe, expect, it} from "vitest";
import {getGalaxyRecordPoint, getGalaxyTheme, getNebulaVArmCenter, sampleNebulaVPoint} from "../../lib/galaxy-themes";

function randomFrom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function cartesian(point: {radius: number; angle: number}) {
  return {x: Math.cos(point.angle) * point.radius, y: Math.sin(point.angle) * point.radius};
}

describe("concert nebula V geometry", () => {
  it("uses an organic nebula theme rather than logo geometry", () => {
    const theme = getGalaxyTheme("concerts");

    expect(theme.title).toBe("V 字星海");
    expect(theme.shape).toBe("nebula-v");
  });

  it("forms two softly curved diagonal gas arms that meet near the bottom", () => {
    for (const arm of [-1, 1] as const) {
      const top = getNebulaVArmCenter(arm, 0);
      const middle = getNebulaVArmCenter(arm, .5);
      const bottom = getNebulaVArmCenter(arm, 1);
      const linearMidX = (top.x + bottom.x) / 2;
      const linearMidY = (top.y + bottom.y) / 2;

      expect(Math.sign(top.x)).toBe(arm);
      expect(Math.sign(middle.x)).toBe(arm);
      expect(top.y).toBeLessThan(bottom.y);
      expect(Math.abs(top.x)).toBeGreaterThan(.6);
      expect(Math.abs(bottom.x)).toBeLessThan(.1);
      expect(Math.abs(middle.x - linearMidX) + Math.abs(middle.y - linearMidY)).toBeGreaterThan(.01);

      for (const point of [top, middle, bottom]) {
        expect(Number.isFinite(point.tangentX) && Number.isFinite(point.tangentY)).toBe(true);
        expect(Math.abs(point.x)).toBeLessThan(.92);
        expect(Math.abs(point.y)).toBeLessThan(.9);
      }
    }
  });

  it("samples a deterministic, bounded blue cloud around both V arms", () => {
    const first = sampleNebulaVPoint(0, randomFrom(1700), .85);
    const repeated = sampleNebulaVPoint(0, randomFrom(1700), .85);
    expect(repeated).toEqual(first);

    const random = randomFrom(1700);
    const samples = Array.from({length: 240}, (_, index) => {
      const point = sampleNebulaVPoint(index, random, .85);
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      expect(Math.abs(point.x)).toBeLessThan(.92);
      expect(Math.abs(point.y)).toBeLessThan(.9);
      return point;
    });

    expect(samples.filter(point => point.x < 0).length).toBeGreaterThan(80);
    expect(samples.filter(point => point.x > 0).length).toBeGreaterThan(80);
    expect(samples.filter(point => point.y < -.35).length).toBeGreaterThan(20);
    expect(samples.filter(point => point.y > .5).length).toBeGreaterThan(20);
  });

  it("places records on alternating V arms, stays bounded, and relayouts deterministically", () => {
    const count = 24;
    const initial = Array.from({length: count}, (_, index) => getGalaxyRecordPoint("concerts", index, 0));
    const repeated = Array.from({length: count}, (_, index) => getGalaxyRecordPoint("concerts", index, 0));
    const relaid = Array.from({length: count}, (_, index) => getGalaxyRecordPoint("concerts", index, 1));
    const points = initial.map(cartesian);

    expect(initial).toEqual(repeated);
    for (const [index, point] of points.entries()) {
      expect(Math.sign(point.x)).toBe(index % 2 === 0 ? -1 : 1);
      expect(Math.abs(point.x)).toBeLessThan(.92);
      expect(Math.abs(point.y)).toBeLessThan(.9);
      expect(initial[index].height).toBe(0);
    }

    const top = points.reduce((result, point) => point.y < result.y ? point : result);
    const bottom = points.reduce((result, point) => point.y > result.y ? point : result);
    expect(top.y).toBeLessThan(-.35);
    expect(bottom.y).toBeGreaterThan(.4);
    expect(Math.abs(top.x)).toBeGreaterThan(Math.abs(bottom.x));
    const moved = initial.filter((point, index) => {
      const next = relaid[index];
      return Math.abs(point.radius - next.radius) > 1e-6
        || Math.abs(point.angle - next.angle) > 1e-6
        || point.height !== next.height;
    });
    expect(moved.length).toBeGreaterThanOrEqual(count * .75);
  });
});
