// Builds src/data/land.json: Natural Earth 1:50m land polygons, clipped to the
// Trikaal map window, simplified and quantised so the app works fully offline.
//
//   node scripts/build-geo.mjs
//
// Only coastlines are kept (no political boundaries). The output is a list of
// rings, each a flat [lon0, lat0, lon1, lat1, ...] array at 0.01 degree precision.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BBOX = { w: 40, s: -10, e: 110, n: 50 };
const TOLERANCE = 0.01; // degrees, Douglas-Peucker
const MIN_AREA = 0.004; // square degrees; drops specks of sand

const topo = JSON.parse(readFileSync(resolve(root, 'node_modules/world-atlas/land-50m.json'), 'utf8'));
const land = feature(topo, topo.objects.land);

function clipRing(ring) {
  // Sutherland-Hodgman against the four edges of the bounding box.
  const edges = [
    (p) => p[0] >= BBOX.w,
    (p) => p[0] <= BBOX.e,
    (p) => p[1] >= BBOX.s,
    (p) => p[1] <= BBOX.n,
  ];
  const intersect = [
    (a, b) => lerpAt(a, b, 0, BBOX.w),
    (a, b) => lerpAt(a, b, 0, BBOX.e),
    (a, b) => lerpAt(a, b, 1, BBOX.s),
    (a, b) => lerpAt(a, b, 1, BBOX.n),
  ];
  let out = ring;
  for (let k = 0; k < 4; k++) {
    const input = out;
    out = [];
    if (!input.length) break;
    let prev = input[input.length - 1];
    for (const cur of input) {
      const cIn = edges[k](cur);
      const pIn = edges[k](prev);
      if (cIn) {
        if (!pIn) out.push(intersect[k](prev, cur));
        out.push(cur);
      } else if (pIn) {
        out.push(intersect[k](prev, cur));
      }
      prev = cur;
    }
  }
  return out;
}

function lerpAt(a, b, axis, value) {
  const t = (value - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function simplify(points, tol) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = perpDist(points[k], points[i], points[j]);
      if (d > maxD) {
        maxD = d;
        idx = k;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([i, idx], [idx, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}

const rings = [];
const polys = land.features.flatMap((f) =>
  f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates,
);
for (const poly of polys) {
  for (const ring of poly) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX < BBOX.w || minX > BBOX.e || maxY < BBOX.s || minY > BBOX.n) continue;
    const clipped = clipRing(ring);
    if (clipped.length < 4) continue;
    const simple = simplify(clipped, TOLERANCE);
    if (simple.length < 4 || ringArea(simple) < MIN_AREA) continue;
    const flat = [];
    for (const [x, y] of simple) flat.push(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
    rings.push(flat);
  }
}

const outPath = resolve(root, 'src/data/land.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ bbox: [BBOX.w, BBOX.s, BBOX.e, BBOX.n], rings }));
const points = rings.reduce((n, r) => n + r.length / 2, 0);
console.log(`land.json: ${rings.length} rings, ${points} points`);
