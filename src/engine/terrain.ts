// An analytic stand-in for the real terrain: the ranges that matter for Indian
// weather (Himalaya, Tibetan Plateau, Western and Eastern Ghats, the north-east
// hills, Arakan Yoma, Sri Lanka's highlands, Hajar, Balochistan) as smooth ridges.

import { type GridSpec, latAt, lonAt } from './grid';
import { KM_PER_DEG } from './geo';

interface Ridge {
  pts: [number, number][];
  h: number;
  w: number; // gaussian half-width, degrees
}

const RIDGES: Ridge[] = [
  { pts: [[72.5, 35.8], [74.5, 34.6], [76.5, 33.0], [78.8, 31.0], [81.0, 29.6], [84.0, 28.4], [86.8, 27.9], [88.6, 27.6], [91.5, 27.7], [94.0, 28.2], [95.8, 28.6], [97.2, 28.0]], h: 5200, w: 0.85 },
  { pts: [[66.5, 35.0], [69.5, 35.7], [71.8, 36.3], [74.5, 36.0], [77.0, 35.3]], h: 4600, w: 1.0 },
  { pts: [[73.4, 21.0], [73.7, 18.5], [73.9, 16.5], [74.6, 14.0], [75.6, 12.2], [76.6, 11.2], [77.1, 9.8], [77.3, 8.5]], h: 1150, w: 0.32 },
  { pts: [[76.4, 11.4], [76.9, 11.3], [77.2, 10.2]], h: 1500, w: 0.28 },
  { pts: [[78.2, 12.4], [79.2, 14.0], [80.3, 16.2], [81.8, 17.8], [83.0, 18.8], [84.2, 20.0], [85.0, 21.2]], h: 650, w: 0.45 },
  { pts: [[72.6, 24.4], [73.8, 25.6], [75.2, 26.9], [76.4, 28.1]], h: 550, w: 0.45 },
  { pts: [[74.0, 22.4], [77.0, 22.6], [80.0, 22.4], [82.2, 22.9]], h: 600, w: 0.6 },
  { pts: [[89.8, 25.5], [91.0, 25.5], [92.3, 25.3]], h: 1300, w: 0.35 },
  { pts: [[93.0, 27.2], [94.3, 26.0], [94.6, 24.5], [93.8, 23.0], [93.3, 21.5], [94.0, 19.0], [94.6, 17.0]], h: 1800, w: 0.55 },
  { pts: [[80.5, 7.4], [80.8, 6.9]], h: 1400, w: 0.3 },
  { pts: [[56.5, 24.2], [57.5, 23.3], [58.5, 22.8], [59.3, 22.6]], h: 1800, w: 0.35 },
  { pts: [[61.0, 30.5], [64.5, 29.0], [66.8, 30.3], [67.5, 32.5], [69.5, 33.8]], h: 2200, w: 1.2 },
  { pts: [[96.5, 23.5], [97.5, 21.0], [98.0, 18.5]], h: 1100, w: 0.9 },
];

const HIMALAYA = RIDGES[0].pts;

function himalayaLat(lon: number): number {
  if (lon <= HIMALAYA[0][0]) return HIMALAYA[0][1];
  for (let i = 0; i < HIMALAYA.length - 1; i++) {
    const [x0, y0] = HIMALAYA[i];
    const [x1, y1] = HIMALAYA[i + 1];
    if (lon <= x1) return y0 + ((lon - x0) / (x1 - x0)) * (y1 - y0);
  }
  return HIMALAYA[HIMALAYA.length - 1][1];
}

function segDist2(lon: number, lat: number, pts: [number, number][]): number {
  const c = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = (pts[i][0] - lon) * c;
    const ay = pts[i][1] - lat;
    const bx = (pts[i + 1][0] - lon) * c;
    const by = pts[i + 1][1] - lat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    best = Math.min(best, px * px + py * py);
  }
  if (pts.length === 1) {
    const ax = (pts[0][0] - lon) * c;
    const ay = pts[0][1] - lat;
    best = ax * ax + ay * ay;
  }
  return best;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Elevation (m) at a point, ignoring the land mask. */
export function elevationAt(lon: number, lat: number): number {
  let h = 0;
  for (const r of RIDGES) {
    const d2 = segDist2(lon, lat, r.pts);
    if (d2 > 9 * r.w * r.w) continue;
    h = Math.max(h, r.h * Math.exp(-d2 / (2 * r.w * r.w)));
  }
  // Tibetan Plateau behind the Himalaya.
  if (lon > 76 && lon < 101 && lat > 27) {
    const hl = himalayaLat(lon);
    const w = smoothstep(hl + 0.4, hl + 1.6, lat) * smoothstep(76.5, 79, lon) * (1 - smoothstep(98.5, 101, lon));
    h = Math.max(h, 4600 * w);
  }
  // Deccan plateau.
  const dx = (lon - 77) / 3.2;
  const dy = (lat - 17.5) / 3.8;
  h = Math.max(h, 560 * Math.exp(-(dx * dx + dy * dy)));
  // Iranian plateau and Afghan highlands.
  if (lon < 70 && lat > 25.5) {
    const w = smoothstep(25.5, 28, lat) * (1 - smoothstep(66, 70, lon));
    h = Math.max(h, 1300 * w);
  }
  return h;
}

export interface TerrainGrid {
  elev: Float32Array;
  /** d(elev)/dx and d(elev)/dy in metres per km. */
  gx: Float32Array;
  gy: Float32Array;
}

const cache = new Map<string, TerrainGrid>();

export function terrainGrid(g: GridSpec, landFrac: Float32Array): TerrainGrid {
  const key = `${g.d}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { nx, ny } = g;
  const elev = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      elev[k] = landFrac[k] > 0 ? elevationAt(lonAt(g, i), latAt(g, j)) * Math.min(1, landFrac[k] * 1.4) : 0;
    }
  }
  const gx = new Float32Array(nx * ny);
  const gy = new Float32Array(nx * ny);
  const dyKm = g.d * KM_PER_DEG;
  for (let j = 1; j < ny - 1; j++) {
    const dxKm = dyKm * Math.cos((latAt(g, j) * Math.PI) / 180);
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      gx[k] = (elev[k + 1] - elev[k - 1]) / (2 * dxKm);
      gy[k] = (elev[k + nx] - elev[k - nx]) / (2 * dyKm);
    }
  }
  const t = { elev, gx, gy };
  cache.set(key, t);
  return t;
}
