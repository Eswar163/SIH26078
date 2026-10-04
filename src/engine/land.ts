// Land mask, land fraction and distance-to-coast on any grid, rasterised from
// the bundled Natural Earth coastline (src/data/land.json).

import landData from '../data/land.json';
import { KM_PER_DEG } from './geo';
import { type GridSpec, latAt, lonAt } from './grid';

export const LAND_RINGS: readonly number[][] = (landData as { rings: number[][] }).rings;

/** Even-odd scanline coverage of the land rings along one latitude. */
function crossings(lat: number): number[] {
  const xs: number[] = [];
  for (const ring of LAND_RINGS) {
    const n = ring.length / 2;
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const ya = ring[a * 2 + 1];
      const yb = ring[b * 2 + 1];
      if (ya <= lat !== yb <= lat) {
        const xa = ring[a * 2];
        const xb = ring[b * 2];
        xs.push(xa + ((lat - ya) * (xb - xa)) / (yb - ya));
      }
    }
  }
  return xs.sort((p, q) => p - q);
}

function insideRow(xs: number[], lon: number): boolean {
  let inside = false;
  for (let k = 0; k < xs.length && xs[k] <= lon; k++) inside = !inside;
  return inside;
}

export interface LandInfo {
  /** 1 where the cell centre is on land. */
  mask: Uint8Array;
  /** Fraction of the cell covered by land (3x3 supersampled). */
  frac: Float32Array;
  /** Distance from the cell centre to the nearest coast, km (positive on land and at sea). */
  coastKm: Float32Array;
}

const cache = new Map<string, LandInfo>();

export function landInfo(g: GridSpec): LandInfo {
  const key = `${g.lon0},${g.lat0},${g.d},${g.nx},${g.ny}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { nx, ny, d } = g;
  const mask = new Uint8Array(nx * ny);
  const frac = new Float32Array(nx * ny);
  const sub = [-d / 3, 0, d / 3];
  for (let j = 0; j < ny; j++) {
    const lat = latAt(g, j);
    const rows = sub.map((o) => crossings(lat + o));
    for (let i = 0; i < nx; i++) {
      const lon = lonAt(g, i);
      let count = 0;
      for (let r = 0; r < 3; r++) for (const o of sub) if (insideRow(rows[r], lon + o)) count++;
      frac[j * nx + i] = count / 9;
      mask[j * nx + i] = insideRow(rows[1], lon) ? 1 : 0;
    }
  }
  const coastKm = distanceToCoast(g, mask);
  const info = { mask, frac, coastKm };
  cache.set(key, info);
  return info;
}

/** Two-pass chamfer distance (km) to the nearest cell of the opposite type. */
function distanceToCoast(g: GridSpec, mask: Uint8Array): Float32Array {
  const { nx, ny, d } = g;
  const INF = 1e9;
  const dist = new Float32Array(nx * ny).fill(INF);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const m = mask[k];
      if (
        (i > 0 && mask[k - 1] !== m) ||
        (i < nx - 1 && mask[k + 1] !== m) ||
        (j > 0 && mask[k - nx] !== m) ||
        (j < ny - 1 && mask[k + nx] !== m)
      ) {
        dist[k] = 0.5 * d * KM_PER_DEG;
      }
    }
  }
  const dy = d * KM_PER_DEG;
  for (let pass = 0; pass < 2; pass++) {
    const forward = pass === 0;
    for (let jj = 0; jj < ny; jj++) {
      const j = forward ? jj : ny - 1 - jj;
      const dx = dy * Math.cos((latAt(g, j) * Math.PI) / 180);
      const dd = Math.sqrt(dx * dx + dy * dy);
      for (let ii = 0; ii < nx; ii++) {
        const i = forward ? ii : nx - 1 - ii;
        const k = j * nx + i;
        let best = dist[k];
        const si = forward ? -1 : 1;
        const sj = forward ? -1 : 1;
        const pi = i + si;
        const pj = j + sj;
        if (pi >= 0 && pi < nx) best = Math.min(best, dist[k + si] + dx);
        if (pj >= 0 && pj < ny) {
          best = Math.min(best, dist[k + sj * nx] + dy);
          if (pi >= 0 && pi < nx) best = Math.min(best, dist[k + sj * nx + si] + dd);
          const qi = i - si;
          if (qi >= 0 && qi < nx) best = Math.min(best, dist[k + sj * nx - si] + dd);
        }
        dist[k] = best;
      }
    }
  }
  return dist;
}

/** Point-in-land test straight from the polygons (used for landfall refinement). */
export function isLandPoint(lon: number, lat: number): boolean {
  return insideRow(crossings(lat), lon);
}
