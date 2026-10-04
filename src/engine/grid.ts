// Regular latitude-longitude grids over the Trikaal domain (50-100E, 0-40N).
// Arrays are row-major with j = 0 at the southern edge.

import { KM_PER_DEG } from './geo';

export interface GridSpec {
  lon0: number;
  lat0: number;
  d: number;
  nx: number;
  ny: number;
}

export const DOMAIN = { w: 50, e: 100, s: 0, n: 40 } as const;

export function makeGrid(d: number): GridSpec {
  return {
    lon0: DOMAIN.w,
    lat0: DOMAIN.s,
    d,
    nx: Math.round((DOMAIN.e - DOMAIN.w) / d) + 1,
    ny: Math.round((DOMAIN.n - DOMAIN.s) / d) + 1,
  };
}

export const lonAt = (g: GridSpec, i: number) => g.lon0 + i * g.d;
export const latAt = (g: GridSpec, j: number) => g.lat0 + j * g.d;
export const size = (g: GridSpec) => g.nx * g.ny;

export function cellOf(g: GridSpec, lon: number, lat: number): number {
  const i = Math.round((lon - g.lon0) / g.d);
  const j = Math.round((lat - g.lat0) / g.d);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return -1;
  return j * g.nx + i;
}

export function inDomain(lon: number, lat: number): boolean {
  return lon >= DOMAIN.w && lon <= DOMAIN.e && lat >= DOMAIN.s && lat <= DOMAIN.n;
}

/** Bilinear sample with edge clamping. */
export function sample(g: GridSpec, f: ArrayLike<number>, lon: number, lat: number): number {
  let x = (lon - g.lon0) / g.d;
  let y = (lat - g.lat0) / g.d;
  x = Math.max(0, Math.min(g.nx - 1.000001, x));
  y = Math.max(0, Math.min(g.ny - 1.000001, y));
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const k = j * g.nx + i;
  const a = f[k];
  const b = f[k + 1];
  const c = f[k + g.nx];
  const d = f[k + g.nx + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** 1-2-1 binomial smoothing, `passes` times. */
export function smooth(g: GridSpec, src: Float32Array, passes = 1): Float32Array {
  const { nx, ny } = g;
  const a = Float32Array.from(src);
  const b = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      for (let i = 0; i < nx; i++) {
        const l = i > 0 ? a[row + i - 1] : a[row + i];
        const r = i < nx - 1 ? a[row + i + 1] : a[row + i];
        b[row + i] = 0.25 * l + 0.5 * a[row + i] + 0.25 * r;
      }
    }
    for (let j = 0; j < ny; j++) {
      const dn = j > 0 ? -nx : 0;
      const up = j < ny - 1 ? nx : 0;
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        a[k] = 0.25 * b[k + dn] + 0.5 * b[k] + 0.25 * b[k + up];
      }
    }
  }
  return a;
}

/** Relative vorticity (s^-1) from u, v (m/s) using centred differences. */
export function vorticity(g: GridSpec, u: Float32Array, v: Float32Array): Float32Array {
  const { nx, ny, d } = g;
  const out = new Float32Array(nx * ny);
  const dy = d * KM_PER_DEG * 1000;
  for (let j = 1; j < ny - 1; j++) {
    const dx = dy * Math.cos((latAt(g, j) * Math.PI) / 180);
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      const dvdx = (v[k + 1] - v[k - 1]) / (2 * dx);
      const dudy = (u[k + nx] - u[k - nx]) / (2 * dy);
      out[k] = dvdx - dudy;
    }
  }
  return out;
}

export function cellAreaKm2(g: GridSpec, j: number): number {
  const s = g.d * KM_PER_DEG;
  return s * s * Math.cos((latAt(g, j) * Math.PI) / 180);
}

/** Resample a field from one grid to another (bilinear). */
export function regrid(from: GridSpec, f: Float32Array, to: GridSpec): Float32Array {
  const out = new Float32Array(to.nx * to.ny);
  for (let j = 0; j < to.ny; j++) {
    const lat = latAt(to, j);
    for (let i = 0; i < to.nx; i++) out[j * to.nx + i] = sample(from, f, lonAt(to, i), lat);
  }
  return out;
}

/** Sum of the last `n` fields (e.g. 24 h rain from four 6 h accumulations). */
export function accumulate(fields: Float32Array[]): Float32Array {
  const out = new Float32Array(fields[0].length);
  for (const f of fields) for (let k = 0; k < out.length; k++) out[k] += f[k];
  return out;
}
