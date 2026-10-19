import {describe, expect, it} from "vitest";
import {projectGalaxyPoint, type GalaxyPoint, type GalaxyProjection} from "../../components/galaxy-scene";
import {getGalaxyRecordPoint, getGalaxyTheme} from "../../lib/galaxy-themes";

describe("galaxy point projection", () => {
  it("returns a point to the same position after a full rotation", () => {
    const point: GalaxyPoint = {radius: 0.64, angle: 0.73, height: 12};
    const projection: GalaxyProjection = {rotation: 0.42, zoom: 1.15};
    const start = projectGalaxyPoint(point, projection);
    const fullTurn = projectGalaxyPoint(point, {...projection, rotation: projection.rotation + Math.PI * 2});

    expect(fullTurn.x).toBeCloseTo(start.x, 9);
    expect(fullTurn.y).toBeCloseTo(start.y, 9);
    expect(fullTurn.depth).toBeCloseTo(start.depth, 9);
    expect(fullTurn.scale).toBeCloseTo(start.scale, 9);
  });

  it("keeps the nucleus fixed while zoom scales a point's offset around it", () => {
    const nucleus = {radius: 0, angle: 0, height: 0};
    const point = {radius: 0.54, angle: 0.81, height: 17};
    const near = projectGalaxyPoint(point, {rotation: 0.2, zoom: 0.8});
    const far = projectGalaxyPoint(point, {rotation: 0.2, zoom: 1.4});
    const center = projectGalaxyPoint(nucleus, {rotation: 0.2, zoom: 0.8});
    const ratio = 1.4 / 0.8;

    expect(projectGalaxyPoint(nucleus, {rotation: 0.2, zoom: 1.4})).toEqual(center);
    expect((far.x - center.x) / (near.x - center.x)).toBeCloseTo(ratio, 9);
    expect((far.y - center.y) / (near.y - center.y)).toBeCloseTo(ratio, 9);
  });

  it("scales both axes uniformly when the viewport keeps the same aspect ratio", () => {
    const point = {radius: 0.72, angle: 2.1, height: 9};
    const base = projectGalaxyPoint(point, {rotation: 0.3, zoom: 1.1});
    const resized = projectGalaxyPoint(point, {rotation: 0.3, zoom: 1.1, width: 900, height: 570});

    expect(resized.x).toBeCloseTo(base.x * 0.75, 9);
    expect(resized.y).toBeCloseTo(base.y * 0.75, 9);
    expect(resized.depth).toBe(base.depth);
    expect(resized.scale).toBe(base.scale);
  });

  it("keeps near and far disk depth consistent and every projected value finite", () => {
    const near = projectGalaxyPoint({radius: 0.7, angle: Math.PI / 2}, {rotation: 0, zoom: 1});
    const far = projectGalaxyPoint({radius: 0.7, angle: Math.PI * 1.5}, {rotation: 0, zoom: 1});

    expect(near.depth).toBeCloseTo(1, 12);
    expect(far.depth).toBeCloseTo(-1, 12);
    expect(near.scale).toBeGreaterThan(far.scale);

    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]) {
      for (const zoom of [0.65, 1, 1.7]) {
        const projected = projectGalaxyPoint(
          {radius: 1, angle, height: 125},
          {rotation: 0.27, zoom, width: 390, height: 844},
        );
        expect([projected.x, projected.y, projected.depth, projected.scale].every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("preserves the original projection when theme geometry is omitted", () => {
    const point = {radius: 0.64, angle: 0.73, height: 12};
    const projection = projectGalaxyPoint(point, {rotation: 0.42, zoom: 1.15});

    expect(projection.x).toBeCloseTo(766.5105843766272, 9);
    expect(projection.y).toBeCloseTo(476.06424319127234, 9);
    expect(projection.depth).toBeCloseTo(0.912763940260521, 12);
  });

  it("uses each type's point layout and angles to orient its projected galaxy", () => {
    const musicTheme = getGalaxyTheme("music");
    const record = getGalaxyRecordPoint("music", 5, 0);
    const point = projectGalaxyPoint(record, {
      rotation: 0,
      zoom: 1,
      inclination: musicTheme.inclination,
      positionAngle: musicTheme.positionAngle,
    });
    const faceOn = projectGalaxyPoint({radius: 0.5, angle: Math.PI / 2}, {rotation: 0, zoom: 1, inclination: 0, positionAngle: 0});
    const inclined = projectGalaxyPoint({radius: 0.5, angle: Math.PI / 2}, {rotation: 0, zoom: 1, inclination: 0.75, positionAngle: 0});
    const quarterTurn = projectGalaxyPoint({radius: 0.5, angle: 0}, {rotation: 0, zoom: 1, inclination: 0, positionAngle: Math.PI / 2});

    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    expect(inclined.y).toBeGreaterThan(faceOn.y);
    expect(quarterTurn.x).toBeCloseTo(600, 8);
    expect(quarterTurn.y).toBeGreaterThan(392);
  });
});
