// Seasonal background climate for the synthetic model. Each season is a set of
// control points (smoothly interpolated with gaussian radial basis functions)
// for pressure, low-level wind, sea surface temperature, vertical wind shear,
// mid-level humidity and background rain, plus an analytic steering flow with a
// subtropical ridge whose latitude oscillates over the run.

import { type GridSpec, latAt, lonAt } from './grid';

export type SeasonId = 'postmonsoon' | 'monsoon' | 'premonsoon' | 'winter';

interface Ctl {
  lon: number;
  lat: number;
  v: number;
  r: number;
}
interface CtlV {
  lon: number;
  lat: number;
  u: number;
  v: number;
  r: number;
}

export interface SteeringSpec {
  ridgeLat: number;
  /** Ridge tilt, degrees of latitude per 10 degrees of longitude. */
  slope: number;
  amp: number;
  period: number;
  ue: number;
  uw: number;
  vBias: number;
  width: number;
  /** Optional Arabian Sea override, blended in west of ~75E. */
  west?: Partial<Omit<SteeringSpec, 'west'>>;
}

export interface Season {
  id: SeasonId;
  label: string;
  months: string;
  mslpBase: number;
  mslp: Ctl[];
  wind: CtlV[];
  sst: Ctl[];
  shear: Ctl[];
  rh: Ctl[];
  rain: Ctl[];
  tLand: [number, number][];
  tAmp: number;
  tAmpArid: number;
  steering: SteeringSpec;
  z500: { tropics: number; k: number; ridge: number };
}

const c = (lon: number, lat: number, v: number, r = 5): Ctl => ({ lon, lat, v, r });
const w = (lon: number, lat: number, u: number, v: number, r = 5): CtlV => ({ lon, lat, u, v, r });

export const SEASONS: Record<SeasonId, Season> = {
  postmonsoon: {
    id: 'postmonsoon',
    label: 'Post-monsoon',
    months: 'October to December',
    mslpBase: 1009,
    mslp: [c(75, 34, 7, 9), c(85, 30, 5, 8), c(65, 30, 4, 8), c(88, 8, -2, 6), c(95, 10, -2, 5), c(70, 8, -1, 6), c(55, 20, 2, 8), c(80, 2, 0, 10), c(78, 20, 2.5, 6)],
    wind: [
      w(88, 18, -3.5, -3.0), w(87, 13, -4.5, -1.5), w(87, 7, -3.0, 0.5), w(85, 2, 3.5, 0.5, 6), w(95, 12, -3.5, -1.0),
      w(63, 21, -1.5, -3.5), w(66, 14, -3.0, -1.5), w(68, 6, -1.0, 0.5), w(72, 10, -2.5, -0.5), w(78, 27, 1.0, -1.5),
      w(78, 21, -1.5, -1.5), w(78, 15, -2.5, -1.0), w(68, 28, 1.0, -2.0), w(88, 33, 4.0, 0, 7), w(96, 20, -1.0, -2.0), w(55, 22, -1.0, -3.0),
    ],
    sst: [c(88, 8, 29.5), c(92, 12, 29.8), c(87, 14, 29.3), c(88, 19, 28.9), c(84, 16, 29.0), c(81, 12, 28.9), c(66, 18, 28.6), c(70, 12, 29.3), c(63, 12, 28.8), c(60, 21, 27.8), c(75, 4, 29.2), c(55, 15, 28.2)],
    shear: [c(87, 10, 8), c(88, 16, 12), c(88, 21, 18), c(68, 12, 10), c(63, 20, 18), c(80, 25, 24), c(75, 30, 30), c(95, 15, 10), c(80, 3, 10)],
    rh: [c(88, 12, 0.72), c(88, 19, 0.65), c(70, 12, 0.62), c(62, 20, 0.4), c(75, 25, 0.35), c(68, 28, 0.25), c(80, 18, 0.5), c(95, 12, 0.75), c(80, 4, 0.7)],
    rain: [c(88, 8, 3.5, 6), c(93, 9, 4.0), c(80, 10.5, 3.2, 3), c(80.8, 7.5, 3.5, 2.5), c(76.5, 9.5, 2.5, 2.5), c(85, 15, 1.5), c(70, 12, 1.2), c(78, 20, 0.6), c(78, 27, 0.15), c(68, 26, 0.05), c(92, 24, 1.0), c(60, 18, 0.2)],
    tLand: [[0, 27.5], [5, 28.0], [10, 28.0], [15, 28.0], [20, 27.5], [25, 26.0], [30, 23.0], [35, 16.0], [40, 10.0]],
    tAmp: 5,
    tAmpArid: 7.5,
    steering: { ridgeLat: 16.5, slope: 0.2, amp: 1.2, period: 144, ue: 5, uw: 9, vBias: 0.3, width: 3.5, west: { ridgeLat: 18, vBias: 0.8 } },
    z500: { tropics: 5885, k: 1.1, ridge: 22 },
  },
  monsoon: {
    id: 'monsoon',
    label: 'Monsoon',
    months: 'June to September',
    mslpBase: 1004,
    mslp: [c(68, 29, -8, 6), c(75, 27, -5, 5), c(82, 24.5, -4, 4), c(88, 21.5, -4, 4), c(72, 15, 4, 7), c(60, 12, 6, 8), c(85, 10, 4, 7), c(80, 3, 6, 8), c(95, 20, -1, 6), c(88, 34, -2, 8), c(55, 22, -2, 6)],
    wind: [
      w(58, 10, 12, 4), w(62, 14, 12, 3), w(66, 15, 10, 1), w(70, 14, 9, 0), w(72, 18, 8, 0.5), w(75, 14, 6, 0), w(80, 14, 7, 0),
      w(85, 12, 7, 1), w(88, 16, 6, 2), w(90, 20, 4, 4), w(92, 23, 1, 4), w(85, 26, -3, 0.5), w(78, 28, -2.5, 0), w(70, 26, 2, 3),
      w(60, 22, 5, 3), w(80, 5, 6, 0), w(95, 15, 6, 2), w(88, 33, 4, 0, 7),
    ],
    sst: [c(60, 12, 26.2), c(65, 15, 27.0), c(70, 12, 27.8), c(72, 18, 28.0), c(88, 15, 29.0), c(88, 20, 29.2), c(92, 12, 29.3), c(80, 4, 28.5), c(84, 9, 28.6)],
    shear: [c(85, 12, 30), c(88, 18, 25), c(75, 15, 32), c(68, 15, 25), c(80, 4, 25), c(80, 25, 20), c(88, 22, 22)],
    rh: [c(88, 18, 0.85), c(85, 23, 0.8), c(78, 23, 0.75), c(74, 16, 0.85), c(68, 26, 0.35), c(60, 20, 0.4), c(88, 10, 0.8), c(70, 10, 0.75)],
    rain: [c(73.5, 16, 5.5, 2.5), c(75.5, 11, 5, 2.5), c(88, 21, 5.5, 3), c(91.5, 25.5, 8, 2.5), c(84, 25, 3.5, 4), c(79, 23, 3.5, 4), c(75, 26, 1.4, 3), c(70, 26, 0.4, 3), c(88, 14, 4.2, 5), c(70, 14, 3.5, 5), c(80, 14, 1.8, 3), c(60, 15, 0.4), c(95, 17, 5.5, 3), c(80, 5, 3, 6)],
    tLand: [[0, 27.0], [5, 27.5], [10, 27.0], [15, 27.0], [20, 28.0], [25, 30.0], [30, 32.0], [35, 25.0], [40, 20.0]],
    tAmp: 4,
    tAmpArid: 6,
    steering: { ridgeLat: 27.5, slope: 0, amp: 1.0, period: 120, ue: 6, uw: 6, vBias: 0.4, width: 4 },
    z500: { tropics: 5880, k: 0.2, ridge: 26 },
  },
  premonsoon: {
    id: 'premonsoon',
    label: 'Pre-monsoon',
    months: 'March to May',
    mslpBase: 1006,
    mslp: [c(70, 27, -5, 7), c(75, 24, -3, 6), c(80, 22, -1.5, 6), c(88, 15, 3, 7), c(65, 15, 3, 8), c(85, 3, 4, 8), c(90, 25, -1, 5), c(55, 22, -2, 6)],
    wind: [
      w(70, 26, 3.5, -1.0), w(77, 24, 3, -0.5), w(82, 22, 1.5, 0.5), w(88, 22, -0.5, 4), w(87, 15, 1, 3), w(85, 8, 3, 1), w(70, 15, 3, 1),
      w(65, 10, 4, 1), w(75, 10, 3.5, 1), w(60, 20, 2, -1.5), w(93, 20, 1, 3), w(90, 26, -1, 2), w(95, 12, 2.5, 1.5), w(88, 33, 6, 0, 7),
    ],
    sst: [c(88, 12, 30.5), c(88, 18, 30.2), c(93, 12, 30.6), c(84, 16, 30.0), c(70, 12, 30.2), c(66, 18, 29.8), c(60, 15, 29.6), c(80, 4, 30.0), c(62, 22, 28.5)],
    shear: [c(88, 12, 10), c(88, 19, 14), c(70, 12, 10), c(65, 20, 16), c(80, 25, 25), c(75, 30, 35), c(95, 15, 12)],
    rh: [c(88, 13, 0.7), c(88, 20, 0.65), c(70, 13, 0.62), c(75, 25, 0.25), c(68, 27, 0.2), c(91, 25, 0.65), c(80, 18, 0.4), c(60, 20, 0.35)],
    rain: [c(91.5, 25.5, 3, 2.5), c(90, 23.5, 2, 2.5), c(88, 23, 1.2, 2.5), c(76.5, 10, 2, 2.5), c(93, 10, 2.5), c(85, 8, 2.5), c(78, 20, 0.2), c(72, 26, 0.05), c(80, 4, 3.5, 6)],
    tLand: [[0, 28.0], [5, 28.5], [10, 29.5], [15, 31.5], [20, 33.0], [25, 34.0], [30, 32.5], [35, 25.0], [40, 18.0]],
    tAmp: 7,
    tAmpArid: 8.5,
    steering: { ridgeLat: 12.5, slope: 0, amp: 1.3, period: 168, ue: 3, uw: 8, vBias: 2.5, width: 3.5, west: { ridgeLat: 17, ue: 2, uw: 4, vBias: 2.8 } },
    z500: { tropics: 5890, k: 1.0, ridge: 22 },
  },
  winter: {
    id: 'winter',
    label: 'Winter',
    months: 'January and February',
    mslpBase: 1012,
    mslp: [c(75, 33, 8, 10), c(85, 30, 7, 9), c(65, 33, 6, 10), c(88, 10, -3, 6), c(80, 6, -3, 6), c(70, 12, -1, 7), c(95, 20, 3, 6), c(55, 22, 4, 8)],
    wind: [
      w(77, 29, 2, -2), w(85, 26, 1, -1.5), w(88, 20, -4, -3.5), w(86, 13, -5, -2), w(82, 9, -5, -1.5), w(80, 4, -2, 0), w(70, 15, -3, -2),
      w(63, 20, -2, -3), w(92, 24, 1, -1), w(97, 20, -2, -2), w(88, 33, 8, 0, 7), w(70, 33, 6, 0, 7),
    ],
    sst: [c(88, 12, 28.0), c(88, 18, 26.5), c(93, 12, 28.3), c(80, 6, 28.0), c(70, 12, 28.0), c(65, 20, 26.0), c(60, 22, 25.0), c(80, 3, 28.5)],
    shear: [c(88, 12, 14), c(88, 18, 25), c(80, 6, 12), c(75, 25, 40), c(75, 33, 50), c(65, 15, 20)],
    rh: [c(85, 10, 0.6), c(88, 18, 0.4), c(75, 25, 0.25), c(80, 6, 0.65), c(70, 12, 0.45), c(75, 33, 0.45)],
    rain: [c(80.5, 8, 2.5, 2.5), c(80, 11, 1.5, 2.5), c(88, 8, 2.0), c(74.5, 34, 1.0, 2.5), c(95, 10, 1.0)],
    tLand: [[0, 26.0], [5, 26.5], [10, 25.5], [15, 24.0], [20, 21.0], [25, 17.0], [30, 13.0], [35, 6.0], [40, 0.0]],
    tAmp: 7,
    tAmpArid: 9,
    steering: { ridgeLat: 15, slope: 0, amp: 1.0, period: 120, ue: 4, uw: 10, vBias: -0.2, width: 3.5 },
    z500: { tropics: 5860, k: 3.3, ridge: 22 },
  },
};

export function seasonForMonth(month: number): SeasonId {
  // month: 0 = January
  if (month <= 1) return 'winter';
  if (month <= 4) return 'premonsoon';
  if (month <= 8) return 'monsoon';
  return 'postmonsoon';
}

/** A representative run date for each season, used when the user switches season. */
export function representativeDate(season: SeasonId, year: number): number {
  const md: Record<SeasonId, [number, number]> = {
    postmonsoon: [9, 4],
    monsoon: [6, 22],
    premonsoon: [4, 12],
    winter: [0, 16],
  };
  const [m, d] = md[season];
  return Date.UTC(year, m, d, 0);
}

// ---------------------------------------------------------------------------
// Radial-basis interpolation

const RAD = Math.PI / 180;

export function rbf(ctls: readonly Ctl[], lon: number, lat: number, fallback: number): number {
  const cl = Math.cos(lat * RAD);
  let ws = 0.015;
  let s = 0.015 * fallback;
  for (const k of ctls) {
    const dx = (lon - k.lon) * cl;
    const dy = lat - k.lat;
    const wgt = Math.exp(-(dx * dx + dy * dy) / (k.r * k.r));
    ws += wgt;
    s += wgt * k.v;
  }
  return s / ws;
}

export function rbfVec(ctls: readonly CtlV[], lon: number, lat: number): [number, number] {
  const cl = Math.cos(lat * RAD);
  let ws = 0.015;
  let su = 0;
  let sv = 0;
  for (const k of ctls) {
    const dx = (lon - k.lon) * cl;
    const dy = lat - k.lat;
    const wgt = Math.exp(-(dx * dx + dy * dy) / (k.r * k.r));
    ws += wgt;
    su += wgt * k.u;
    sv += wgt * k.v;
  }
  return [su / ws, sv / ws];
}

/** Interpolate the land temperature profile by latitude. */
export function tLandAt(season: Season, lat: number): number {
  const p = season.tLand;
  if (lat <= p[0][0]) return p[0][1];
  for (let i = 0; i < p.length - 1; i++) {
    if (lat <= p[i + 1][0]) {
      const f = (lat - p[i][0]) / (p[i + 1][0] - p[i][0]);
      return p[i][1] + f * (p[i + 1][1] - p[i][1]);
    }
  }
  return p[p.length - 1][1];
}

/** Desert weighting for a larger diurnal range (Thar, Sindh, Arabia, Balochistan). */
export function aridity(lon: number, lat: number): number {
  const a = Math.exp(-(((lon - 70.5) / 4.5) ** 2 + ((lat - 26.5) / 3.5) ** 2));
  const b = Math.exp(-(((lon - 56) / 5) ** 2 + ((lat - 21) / 4) ** 2));
  const c2 = Math.exp(-(((lon - 64) / 4) ** 2 + ((lat - 28) / 3) ** 2));
  return Math.min(1, a + b + c2);
}

// ---------------------------------------------------------------------------
// Static background fields for a run, computed once per (season, grid).

export interface Background {
  mslp: Float32Array;
  u: Float32Array;
  v: Float32Array;
  sst: Float32Array;
  shear: Float32Array;
  rh: Float32Array;
  rainClim: Float32Array;
  /** Daily mean 2 m temperature at sea level over land, before lapse-rate correction. */
  tMean: Float32Array;
  tAmp: Float32Array;
}

const bgCache = new Map<string, Background>();

export function background(season: Season, g: GridSpec): Background {
  const key = `${season.id}:${g.d}`;
  const hit = bgCache.get(key);
  if (hit) return hit;
  const n = g.nx * g.ny;
  const bg: Background = {
    mslp: new Float32Array(n),
    u: new Float32Array(n),
    v: new Float32Array(n),
    sst: new Float32Array(n),
    shear: new Float32Array(n),
    rh: new Float32Array(n),
    rainClim: new Float32Array(n),
    tMean: new Float32Array(n),
    tAmp: new Float32Array(n),
  };
  for (let j = 0; j < g.ny; j++) {
    const lat = latAt(g, j);
    const tl = tLandAt(season, lat);
    for (let i = 0; i < g.nx; i++) {
      const lon = lonAt(g, i);
      const k = j * g.nx + i;
      bg.mslp[k] = season.mslpBase + rbf(season.mslp, lon, lat, 0);
      const [u, v] = rbfVec(season.wind, lon, lat);
      bg.u[k] = u;
      bg.v[k] = v;
      bg.sst[k] = rbf(season.sst, lon, lat, 28);
      bg.shear[k] = rbf(season.shear, lon, lat, 15);
      bg.rh[k] = rbf(season.rh, lon, lat, 0.5);
      bg.rainClim[k] = rbf(season.rain, lon, lat, 0.3);
      bg.tMean[k] = tl;
      bg.tAmp[k] = season.tAmp + (season.tAmpArid - season.tAmp) * aridity(lon, lat);
    }
  }
  bgCache.set(key, bg);
  return bg;
}

/** Point versions for the dynamics, which needs the environment along a track. */
export function envAt(season: Season, lon: number, lat: number) {
  return {
    sst: rbf(season.sst, lon, lat, 28),
    shear: rbf(season.shear, lon, lat, 15),
    rh: rbf(season.rh, lon, lat, 0.5),
  };
}

export function z500Background(season: Season, lat: number): number {
  const z = season.z500;
  return z.tropics - z.k * Math.max(0, lat - z.ridge) ** 1.7;
}
