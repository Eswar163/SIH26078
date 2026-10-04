// Field synthesiser: turns the weather-systems layer into gridded model output,
// the same kind of fields a forecaster pulls from an NWP run.
//
//   mslp   mean sea-level pressure (hPa)
//   u10    10 m wind, eastward (m/s)
//   v10    10 m wind, northward (m/s)
//   rain6  precipitation accumulated over the 6 h ending at t (mm)
//   t2m    2 m temperature at t (deg C)
//   tmax   maximum 2 m temperature over the 24 h ending at t (deg C)
//   tmin   minimum 2 m temperature over the 24 h ending at t (deg C)
//   z500   500 hPa geopotential height (gpm)

import { type Background, type Season, SEASONS, background, z500Background, type SeasonId } from './climate';
import { KM_PER_DEG } from './geo';
import { type GridSpec, latAt, lonAt } from './grid';
import { type LandInfo, landInfo } from './land';
import { fbm3, makeNoise3, type Noise3 } from './rng';
import { type TerrainGrid, terrainGrid } from './terrain';
import { type SysState, hollandWind, pressureDeficit } from './world';

export interface FieldSet {
  t: number;
  mslp: Float32Array;
  u10: Float32Array;
  v10: Float32Array;
  rain6: Float32Array;
  t2m: Float32Array;
  tmax: Float32Array;
  tmin: Float32Array;
  z500: Float32Array;
}

export const FIELD_KEYS = ['mslp', 'u10', 'v10', 'rain6', 't2m', 'tmax', 'tmin', 'z500'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export interface SynthContext {
  season: Season;
  g: GridSpec;
  bg: Background;
  land: LandInfo;
  terrain: TerrainGrid;
  /** Climatological daily maximum and minimum temperature (no anomalies). */
  tmaxNormal: Float32Array;
  tminNormal: Float32Array;
  noise: Noise3;
  rainNoise: Noise3;
  analysis: number;
  /** Shifts the background-noise clock with lead time, so ensemble members decorrelate. */
  noiseDrift: number;
  noiseOrigin: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const ADVECT: Record<SeasonId, [number, number]> = {
  postmonsoon: [-0.08, 0.0],
  monsoon: [-0.06, 0.03],
  premonsoon: [0.05, 0.03],
  winter: [0.1, 0.0],
};

export function makeSynthContext(
  seasonId: SeasonId,
  g: GridSpec,
  seed: number,
  analysis: number,
  noiseDrift = 0,
  noiseOrigin = 0,
): SynthContext {
  const season = SEASONS[seasonId];
  const bg = background(season, g);
  const land = landInfo(g);
  const terrain = terrainGrid(g, land.frac);
  const n = g.nx * g.ny;
  const tmaxNormal = new Float32Array(n);
  const tminNormal = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const { tm, amp } = landTemp(bg, land, terrain, k);
    const f = land.frac[k];
    tmaxNormal[k] = f * (tm + amp) + (1 - f) * (bg.sst[k] - 0.3);
    tminNormal[k] = f * (tm - 0.95 * amp) + (1 - f) * (bg.sst[k] - 1.3);
  }
  return {
    season,
    g,
    bg,
    land,
    terrain,
    tmaxNormal,
    tminNormal,
    noise: makeNoise3(seed, 'synoptic'),
    rainNoise: makeNoise3(seed, 'rain'),
    analysis,
    noiseDrift,
    noiseOrigin,
  };
}

function landTemp(bg: Background, land: LandInfo, terrain: TerrainGrid, k: number) {
  const coastal = smoothstep(0, 90, land.coastKm[k]);
  const tm = bg.tMean[k] - (6.5 * terrain.elev[k]) / 1000 + (1 - coastal) * 0.25 * (bg.sst[k] - 0.8 - bg.tMean[k]);
  const amp = bg.tAmp[k] * (0.5 + 0.5 * coastal) * (1 - Math.min(0.4, bg.rainClim[k] * 0.045));
  return { tm, amp };
}

/** Sample a smooth noise function on a coarse 1-degree lattice, then interpolate. */
function coarse(g: GridSpec, fn: (lon: number, lat: number) => number): Float32Array {
  const cnx = 52;
  const cny = 42;
  const c = new Float32Array(cnx * cny);
  for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) c[j * cnx + i] = fn(g.lon0 + i - 0.5, g.lat0 + j - 0.5);
  const out = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) {
    const y = latAt(g, j) - g.lat0 + 0.5;
    const j0 = Math.min(cny - 2, Math.floor(y));
    const fy = y - j0;
    for (let i = 0; i < g.nx; i++) {
      const x = lonAt(g, i) - g.lon0 + 0.5;
      const i0 = Math.min(cnx - 2, Math.floor(x));
      const fx = x - i0;
      const k = j0 * cnx + i0;
      const a = c[k];
      const b = c[k + 1];
      const cc = c[k + cnx];
      const d = c[k + cnx + 1];
      out[j * g.nx + i] = a + (b - a) * fx + (cc - a) * fy + (a - b - cc + d) * fx * fy;
    }
  }
  return out;
}

/**
 * Synthesise all fields at hour t.
 * `statesAt` returns the weather systems at any hour (used for the 6 h rain window).
 */
export function synthesize(ctx: SynthContext, t: number, statesAt: (h: number) => SysState[]): FieldSet {
  const { g, bg, land, terrain, season } = ctx;
  const { nx, ny } = g;
  const n = nx * ny;
  const lead = Math.max(0, t - ctx.noiseOrigin);
  const tn = t + ctx.noiseDrift * lead;

  const mslp = new Float32Array(n);
  const u10 = new Float32Array(n);
  const v10 = new Float32Array(n);
  const rain6 = new Float32Array(n);
  const t2m = new Float32Array(n);
  const tmax = new Float32Array(n);
  const tmin = new Float32Array(n);
  const z500 = new Float32Array(n);

  // --- background -----------------------------------------------------------
  const pNoise = coarse(g, (lon, lat) => 0.8 * fbm3(ctx.noise, lon / 14, lat / 14, tn / 96 + 3.1, 2));
  const psi = coarse(g, (lon, lat) => fbm3(ctx.noise, lon / 9 + 40, lat / 9, tn / 60, 2));
  const tNoise = coarse(g, (lon, lat) => fbm3(ctx.noise, lon / 6 + 80, lat / 6, tn / 48, 2));
  const date = new Date(ctx.analysis + t * 3600_000);
  const utcHour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const [ax, ay] = ADVECT[season.id];
  const dyKm = g.d * KM_PER_DEG;

  for (let j = 0; j < ny; j++) {
    const lat = latAt(g, j);
    const zb = z500Background(season, lat);
    const cosl = Math.cos((lat * Math.PI) / 180);
    const jm = Math.max(0, j - 1);
    const jp = Math.min(ny - 1, j + 1);
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const lon = lonAt(g, i);
      const f = land.frac[k];
      mslp[k] = bg.mslp[k] + pNoise[k];
      // Stream-function noise gives rotational, flow-like perturbations.
      const im = Math.max(0, i - 1);
      const ip = Math.min(nx - 1, i + 1);
      const dpsidx = (psi[j * nx + ip] - psi[j * nx + im]) / ((ip - im) * dyKm * cosl);
      const dpsidy = (psi[jp * nx + i] - psi[jm * nx + i]) / ((jp - jm) * dyKm);
      const amp = 260;
      const landDrag = 1 - 0.35 * f;
      u10[k] = (bg.u[k] - amp * dpsidy) * landDrag;
      v10[k] = (bg.v[k] + amp * dpsidx) * landDrag;

      const solar = (((utcHour + lon / 15) % 24) + 24) % 24;
      const { tm, amp: ta } = landTemp(bg, land, terrain, k);
      const tn2 = 1.1 * tNoise[k];
      const tLand = tm + ta * Math.cos((2 * Math.PI * (solar - 14.5)) / 24) + tn2;
      const tSea = bg.sst[k] - 0.8 + 0.3 * tn2;
      t2m[k] = f * tLand + (1 - f) * tSea;
      tmax[k] = f * (tm + ta + tn2) + (1 - f) * (bg.sst[k] - 0.3 + 0.3 * tn2);
      tmin[k] = f * (tm - 0.95 * ta + 0.8 * tn2) + (1 - f) * (bg.sst[k] - 1.3 + 0.3 * tn2);

      // Background rain: climatology modulated by drifting fractal noise.
      const nr = fbm3(ctx.rainNoise, (lon - ax * tn) / 3.2, (lat - ay * tn) / 3.2, tn / 30, 3);
      const mult = Math.pow(Math.max(0, nr + 0.12), 1.6) * 3.2;
      const diurnal = f > 0.5 ? 1 + 0.6 * Math.cos((2 * Math.PI * (solar - 17)) / 24) : 1 + 0.15 * Math.cos((2 * Math.PI * (solar - 5)) / 24);
      rain6[k] = bg.rainClim[k] * mult * diurnal;
      z500[k] = zb + 12 * tNoise[k];
    }
  }

  // --- weather systems ----------------------------------------------------------
  const now = statesAt(t);
  const mid1 = statesAt(t - 4.5);
  const mid2 = statesAt(t - 1.5);
  for (const s of now) addDynamics(ctx, s, mslp, u10, v10, t2m, tmax, tmin, z500);
  for (const s of mid1) addRain(ctx, s, rain6, 3, t - 4.5);
  for (const s of mid2) addRain(ctx, s, rain6, 3, t - 1.5);

  // --- orography and rain cooling ----------------------------------------------
  for (let k = 0; k < n; k++) {
    if (land.frac[k] > 0.05) {
      const gUp = u10[k] * terrain.gx[k] + v10[k] * terrain.gy[k];
      const oro = gUp > 0 ? 1 + Math.min(2.2, gUp / 85) : Math.max(0.4, 1 + gUp / 260);
      rain6[k] *= oro;
      const cool = Math.min(4, rain6[k] * 0.06) * land.frac[k];
      t2m[k] -= cool;
      tmax[k] -= cool * 0.8;
    }
  }
  return { t, mslp, u10, v10, rain6, t2m, tmax, tmin, z500 };
}

function forBox(g: GridSpec, lon: number, lat: number, radiusKm: number, cb: (k: number, dx: number, dy: number, r: number) => void) {
  const cosl = Math.cos((lat * Math.PI) / 180);
  const dLat = radiusKm / KM_PER_DEG;
  const dLon = dLat / Math.max(0.2, cosl);
  const i0 = Math.max(0, Math.floor((lon - dLon - g.lon0) / g.d));
  const i1 = Math.min(g.nx - 1, Math.ceil((lon + dLon - g.lon0) / g.d));
  const j0 = Math.max(0, Math.floor((lat - dLat - g.lat0) / g.d));
  const j1 = Math.min(g.ny - 1, Math.ceil((lat + dLat - g.lat0) / g.d));
  const r2max = radiusKm * radiusKm;
  for (let j = j0; j <= j1; j++) {
    const dy = (latAt(g, j) - lat) * KM_PER_DEG;
    for (let i = i0; i <= i1; i++) {
      const dx = (lonAt(g, i) - lon) * cosl * KM_PER_DEG;
      const r2 = dx * dx + dy * dy;
      if (r2 > r2max) continue;
      cb(j * g.nx + i, dx, dy, Math.sqrt(r2));
    }
  }
}

function addDynamics(
  ctx: SynthContext,
  s: SysState,
  mslp: Float32Array,
  u10: Float32Array,
  v10: Float32Array,
  t2m: Float32Array,
  tmax: Float32Array,
  tmin: Float32Array,
  z500: Float32Array,
) {
  const { g, land } = ctx;
  if (s.kind === 'tc' || s.kind === 'mlow') {
    const dp = pressureDeficit(s.kind, s.v);
    const R = Math.min(1700, 1.6 * s.roci);
    const inflowSea = (20 * Math.PI) / 180;
    const inflowLand = (32 * Math.PI) / 180;
    const vmaxMs = s.v * 0.5144;
    forBox(g, s.lon, s.lat, R, (k, dx, dy, r) => {
      const taper = 1 - smoothstep(0.9 * s.roci, R, r);
      const rr = Math.max(r, 2);
      const x = Math.pow(s.rmax / rr, s.b);
      mslp[k] -= dp * (1 - Math.exp(-x)) * taper;
      const f = land.frac[k];
      let vt = hollandWind(vmaxMs, s.rmax, s.b, rr) * taper * (1 - 0.22 * f);
      if (r < 1) vt = 0;
      const beta = inflowSea + (inflowLand - inflowSea) * f;
      const rx = dx / rr;
      const ry = dy / rr;
      // Cyclonic (anticlockwise) tangential wind turned inward by the inflow angle.
      const tx = -ry;
      const ty = rx;
      const asym = vmaxMs > 0 ? (0.45 * vt) / vmaxMs : 0;
      u10[k] += vt * (Math.cos(beta) * tx - Math.sin(beta) * rx) + asym * s.cu;
      v10[k] += vt * (Math.cos(beta) * ty - Math.sin(beta) * ry) + asym * s.cv;
      z500[k] -= 0.6 * dp * (1 - Math.exp(-x)) * taper;
    });
  } else if (s.kind === 'wd') {
    const A = s.v;
    const R = Math.min(1900, 2.2 * s.rmax);
    forBox(g, s.lon, s.lat, R, (k, dx, dy, r) => {
      const ax = dx / (s.rmax * 1.1);
      const ay = dy / (s.rmax * 1.8);
      z500[k] -= A * Math.exp(-(ax * ax + ay * ay));
      const bx = (dx - 0.25 * s.rmax) / (s.rmax * 0.9);
      const by = dy / s.rmax;
      mslp[k] -= 0.04 * A * Math.exp(-(bx * bx + by * by));
      const rr = Math.max(r, 2);
      const vt = 0.06 * A * (rr / s.rmax) * Math.exp(1 - rr / s.rmax) * (1 - 0.3 * land.frac[k]);
      u10[k] += vt * (-dy / rr);
      v10[k] += vt * (dx / rr);
    });
  } else if (s.kind === 'heat' || s.kind === 'cold') {
    const A = s.v;
    const sigma = s.rmax;
    forBox(g, s.lon, s.lat, 2.6 * sigma, (k, _dx, _dy, r) => {
      const w = Math.exp(-(r * r) / (2 * sigma * sigma));
      const lf = 0.3 + 0.7 * land.frac[k];
      if (s.kind === 'heat') {
        t2m[k] += A * w * lf * 0.9;
        tmax[k] += A * w * lf;
        tmin[k] += 0.6 * A * w * lf;
        mslp[k] -= 0.25 * A * w;
        z500[k] += 8 * A * w;
      } else {
        t2m[k] -= 0.8 * A * w * lf;
        tmax[k] -= 0.55 * A * w * lf;
        tmin[k] -= A * w * lf;
        mslp[k] += 0.35 * A * w;
        z500[k] -= 2 * A * w;
      }
    });
  }
}

function addRain(ctx: SynthContext, s: SysState, rain6: Float32Array, hours: number, t: number) {
  const { g, terrain, land } = ctx;
  if (s.kind === 'tc' || s.kind === 'mlow') {
    const isTc = s.kind === 'tc';
    const peak = (isTc ? 12 + 0.9 * s.v : 10 + 1.0 * s.v) * s.rainEff;
    const re = isTc ? 85 + 0.7 * s.rmax : 230;
    const R = isTc ? Math.min(1100, 4.2 * re + s.rmax) : 1100;
    // Front-left of motion for cyclones, south-west sector for monsoon lows.
    const motion = Math.atan2(s.cv, s.cu);
    const favoured = isTc ? motion + Math.PI / 4 : (-135 * Math.PI) / 180;
    const asymAmp = isTc ? 0.4 : 0.6;
    const bandAmp = isTc ? 0.45 : 0.2;
    const phase = t * 0.05;
    forBox(g, s.lon, s.lat, R, (k, dx, dy, r) => {
      const rr = Math.max(r, 1);
      const radial = rr < s.rmax ? 0.55 + 0.45 * (rr / s.rmax) : Math.exp(-(rr - s.rmax) / re);
      const theta = Math.atan2(dy, dx);
      const asym = 1 + asymAmp * Math.cos(theta - favoured);
      const band = rr > s.rmax ? 1 + bandAmp * Math.sin(2 * (theta + 1.6 * Math.log(rr / s.rmax)) + phase) : 1;
      const edge = 1 - smoothstep(0.75 * R, R, r);
      rain6[k] += (peak / 6) * hours * radial * asym * band * edge;
    });
  } else if (s.kind === 'wd') {
    const A = s.v;
    const sigma = 0.9 * s.rmax;
    forBox(g, s.lon, s.lat, 2.4 * s.rmax, (k, dx, dy) => {
      const bx = (dx - 0.6 * s.rmax) / sigma;
      const by = (dy - 0.1 * s.rmax) / sigma;
      const w = Math.exp(-(bx * bx + by * by));
      const tf = Math.max(0, Math.min(1, terrain.elev[k] / 2200));
      const lf = 0.3 + 0.7 * land.frac[k];
      rain6[k] += ((A / 100) * 10 * w * (0.35 + 1.1 * tf) * lf * hours) / 6;
    });
  } else if (s.kind === 'conv') {
    const sigma = s.rmax;
    forBox(g, s.lon, s.lat, 3 * sigma, (k, _dx, _dy, r) => {
      const w = Math.exp(-(r * r) / (2 * sigma * sigma));
      rain6[k] += (s.v * w * hours) / 6;
    });
  }
}

/** The static fields of a run, used for map layers and the intelligence engine. */
export function staticFields(ctx: SynthContext) {
  return {
    sst: ctx.bg.sst,
    shear: ctx.bg.shear,
    rh: ctx.bg.rh,
    elev: ctx.terrain.elev,
    landFrac: ctx.land.frac,
    landMask: ctx.land.mask,
    coastKm: ctx.land.coastKm,
    tmaxNormal: ctx.tmaxNormal,
    tminNormal: ctx.tminNormal,
  };
}
