import { describe, expect, it } from "vitest";
import { buildLensDisplacement } from "../../components/liquid-glass-map";

type LensMap = ReturnType<typeof buildLensDisplacement>;
function channels(map: LensMap, x: number, y: number) {
  const index = (Math.floor(y) * map.width + Math.floor(x)) * 4;
  return Array.from(map.data.slice(index, index + 4));
}

describe("rounded glass displacement", () => {
  it("leaves the readable centre and the area inside the curved lip neutral", () => {
    const map = buildLensDisplacement(200, 120, 24, 10);
    for (const [x, y] of [[100, 60], [20, 60], [180, 60], [100, 20], [100, 100]]) {
      expect(channels(map, x, y)).toEqual([128, 128, 128, 255]);
    }
  });

  it("bends opposite edges in opposite directions without bending the tangential axis", () => {
    const map = buildLensDisplacement(200, 120, 24, 10);
    const left = channels(map, 4, 60), right = channels(map, 195, 60);
    const top = channels(map, 100, 4), bottom = channels(map, 100, 115);
    expect(left[0]).toBeLessThan(64);
    expect(right[0]).toBeGreaterThan(192);
    expect(left[0] + right[0]).toBe(256);
    expect(left[1]).toBe(128);
    expect(right[1]).toBe(128);
    expect(top[1]).toBeLessThan(64);
    expect(bottom[1]).toBeGreaterThan(192);
    expect(top[1] + bottom[1]).toBe(256);
    expect(top[0]).toBe(128);
    expect(bottom[0]).toBe(128);
  });

  it("follows the rounded corner normal while limiting allocations for large surfaces", () => {
    const rounded = buildLensDisplacement(200, 120, 24, 10);
    const corner = channels(rounded, 10, 10);
    expect(corner[0]).toBeLessThan(100);
    expect(corner[1]).toBeLessThan(100);
    expect(corner[0]).toBe(corner[1]);
    const large = buildLensDisplacement(4000, 3000, 40, 10);
    expect(large.width).toBeLessThanOrEqual(640);
    expect(large.height).toBeLessThanOrEqual(480);
    expect(large.data.byteLength).toBeLessThanOrEqual(640 * 480 * 4);
    expect(channels(large, large.width / 2, large.height / 2)).toEqual([128, 128, 128, 255]);
  });
});
