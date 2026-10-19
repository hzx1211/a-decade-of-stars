type Point = readonly [number, number];
type Polygon = ReadonlyArray<Point>;
type Triangle = readonly [Point, Point, Point];

/** The two original tour-logo outlines, in their original SVG coordinates. */
export const vMarkOriginalPolygons: ReadonlyArray<Polygon> = [
  [[150, 289], [501, 294], [538, 373], [397, 373], [551, 885], [505, 997], [250, 993], [213, 919], [446, 923], [274, 372], [194, 371]],
  [[631, 295], [989, 303], [938, 373], [863, 373], [653, 923], [888, 925], [844, 1000], [516, 997], [744, 373], [590, 373]],
] as const;

/** SVG and star-field rendering use exactly the same vertices. */
export const vMarkSilhouette = vMarkOriginalPolygons.map(polygon => polygon.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join("") + "Z").join(" ");

export const vMarkPolygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = vMarkOriginalPolygons.map(polygon => polygon.map(([x, y]) => [(x - 570) / 530, (y - 645) / 530] as const));

const EPSILON = 1e-12;
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function signedArea(polygon: Polygon) {
  return polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function insideTriangle(point: Point, triangle: Triangle) {
  const a = cross(triangle[0], triangle[1], point);
  const b = cross(triangle[1], triangle[2], point);
  const c = cross(triangle[2], triangle[0], point);
  return !((a < -EPSILON || b < -EPSILON || c < -EPSILON) && (a > EPSILON || b > EPSILON || c > EPSILON));
}

/** Ear clipping handles the inward serifs and the deliberately separate feet. */
function triangulate(polygon: Polygon): Triangle[] {
  const vertices = [...polygon];
  const orientation = Math.sign(signedArea(polygon));
  const triangles: Triangle[] = [];
  while (vertices.length > 3) {
    let clipped = false;
    for (let index = 0; index < vertices.length; index++) {
      const previousIndex = (index + vertices.length - 1) % vertices.length;
      const nextIndex = (index + 1) % vertices.length;
      const triangle: Triangle = [vertices[previousIndex], vertices[index], vertices[nextIndex]];
      if (cross(...triangle) * orientation <= EPSILON) continue;
      if (vertices.some((point, pointIndex) => pointIndex !== previousIndex && pointIndex !== index && pointIndex !== nextIndex && insideTriangle(point, triangle))) continue;
      triangles.push(triangle);
      vertices.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error("The V mark outline could not be triangulated");
  }
  triangles.push([vertices[0], vertices[1], vertices[2]]);
  return triangles;
}

const trianglesByLeg = vMarkPolygons.map(triangulate);
const triangleArea = (triangle: Triangle) => Math.abs(cross(...triangle)) / 2;
const samplingSet = (triangles: ReadonlyArray<Triangle>) => {
  const areas = triangles.map(triangleArea);
  return {triangles, areas, totalArea: areas.reduce((sum, area) => sum + area, 0)};
};
const samplesByLeg = trianglesByLeg.map(samplingSet);
const allSamples = samplingSet(trianglesByLeg.flat());

function sampleTriangles({triangles, areas, totalArea}: ReturnType<typeof samplingSet>, u: number, v: number) {
  const unit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0;
  let remaining = unit(u) * totalArea;
  let index = 0;
  while (index < triangles.length - 1 && remaining >= areas[index]) remaining -= areas[index++];
  const [a, b, c] = triangles[index];
  const root = Math.sqrt(Math.max(0, Math.min(1, remaining / areas[index])));
  const second = unit(v);
  return {
    x: (1 - root) * a[0] + root * (1 - second) * b[0] + root * second * c[0],
    y: (1 - root) * a[1] + root * (1 - second) * b[1] + root * second * c[1],
  };
}

/** Uniform area sampling across both polygons, with no samples in the V's gap. */
export function sampleVMarkPoint(u: number, v: number): {x: number; y: number} {
  return sampleTriangles(allSamples, u, v);
}

/** Alternating story markers can give both legs equal representation. */
export function sampleVMarkLegPoint(leg: 0 | 1, u: number, v: number): {x: number; y: number} {
  return sampleTriangles(samplesByLeg[leg], u, v);
}

export function isInsideVMark(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return trianglesByLeg.some(triangles => triangles.some(triangle => insideTriangle([x, y], triangle)));
}
