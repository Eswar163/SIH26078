// The synthetic atmosphere's "weather systems layer".
//
// A world is a set of weather systems (tropical lows and cyclones, monsoon lows,
// western disturbances, heat and cold anomalies, convective clusters) evolved
// hour by hour with a light-weight physical model:
//   motion     = deep-layer steering (subtropical ridge + WD troughs) + beta drift
//                + binary interaction + red noise
//   intensity  = relaxation towards a potential intensity set by SST, shear and
//                humidity over the sea; exponential decay over land
//                (Kaplan-DeMaria style, with an optional "brown ocean" brake)
//   structure  = radius of maximum wind and outer radius follow intensity
//
// The same machinery produces the hidden truth (the "nature run"), the
// deterministic forecast, each ensemble member and every scenario. Fields
// (pressure, wind, rain, temperature) are synthesised from these systems in
// synth.ts, and the detection and tracking pipeline only ever sees those fields.

import { type SeasonId, type Season, SEASONS, envAt, rbfVec } from './climate';
import { advect, distKm, destination, bearingDeg } from './geo';
import { makeGrid, sample } from './grid';
import { landInfo } from './land';
import { elevationAt } from './terrain';
import { makeRng, ouStep, type Rng } from './rng';

export type SysKind = 'tc' | 'mlow' | 'wd' | 'heat' | 'cold' | 'conv';
export type SysRelation = 'split' | 'induced';

export interface Spawn {
  id: number;
  t: number;
  kind: SysKind;
  lon: number;
  lat: number;
  /** Initial intensity: kt for vortices, peak amplitude for the others. */
  v: number;
  size: number;
  growth: number;
  life: number;
  parent?: { id: number; relation: SysRelation; km: number; bearing: number; share: number };
}

export interface SysHistory {
  id: number;
  kind: SysKind;
  /** Hour of the first record. */
  t0: number;
  lon: Float32Array;
  lat: Float32Array;
  v: Float32Array;
  rmax: Float32Array;
  roci: Float32Array;
  cu: Float32Array;
  cv: Float32Array;
  land: Float32Array;
  ouU: Float32Array;
  ouV: Float32Array;
  b: number;
  rainEff: number;
  parent?: { id: number; relation: SysRelation };
  mergedInto?: { id: number; t: number };
  /** Set on forecast copies: which truth system this one descends from. */
  truthId?: number;
  spurious?: boolean;
}

export interface Realization {
  stream: string;
  ouSigma: number;
  ridgeShift: number;
  ridgePhase: number;
  steerMult: number;
  steerRotate: number;
  sstDelta: number;
  sstDeltaBay: number;
  sstDeltaArb: number;
  shearMult: number;
  rhDelta: number;
  mjo: number;
  brownOcean: number;
  intensityBias: number;
  growthMult: number;
}

export const BASE_REALIZATION: Omit<Realization, 'stream'> = {
  ouSigma: 0.6,
  ridgeShift: 0,
  ridgePhase: 0,
  steerMult: 1,
  steerRotate: 0,
  sstDelta: 0,
  sstDeltaBay: 0,
  sstDeltaArb: 0,
  shearMult: 1,
  rhDelta: 0,
  mjo: 0,
  brownOcean: 0,
  intensityBias: 1,
  growthMult: 1,
};

export interface World {
  season: SeasonId;
  seed: number;
  /** Epoch ms of the analysis time (t = 0). */
  analysis: number;
  ridgePhase: number;
  spawns: Spawn[];
  truth: SysHistory[];
  tStart: number;
  tEnd: number;
}

export const TRUTH_START = -144;
export const TRUTH_END = 240;

// ---------------------------------------------------------------------------
// Helpers shared with the field synthesiser

export function mpiKt(sst: number): number {
  // DeMaria & Kaplan (1994) empirical maximum potential intensity, m/s -> kt.
  return Math.max(0, (28.2 + 55.8 * Math.exp(0.1813 * (sst - 30))) * 1.943844);
}

/** Central pressure deficit (hPa) for a vortex of max wind v (kt). */
export function pressureDeficit(kind: SysKind, v: number): number {
  if (kind === 'mlow') return Math.pow(Math.max(0, v) / 5.6, 1.553);
  return Math.pow(Math.max(0, v) / 6.7, 1.553);
}

/** Simplified Holland (1980) wind profile, normalised so that V(rmax) = vmax. */
export function hollandWind(vmax: number, rmax: number, b: number, r: number): number {
  if (r <= 0) return 0;
  const x = Math.pow(rmax / r, b);
  return vmax * Math.sqrt(x * Math.exp(1 - x));
}

const envelope = (x: number) => {
  const s = (a: number, b: number, v: number) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return s(0, 0.3, x) * (1 - s(0.62, 1, x));
};

const LAND_GRID = makeGrid(0.25);
let landFracCache: Float32Array | null = null;
function landFracAt(lon: number, lat: number): number {
  if (!landFracCache) landFracCache = landInfo(LAND_GRID).frac;
  if (lon < 50 || lon > 100 || lat < 0 || lat > 40) {
    // Outside the grid: Arabia and Iran to the west, Indochina to the east are land.
    if (lon < 50 && lat > 12) return 1;
    if (lon > 100 && lat > 5) return 1;
    return 0;
  }
  return sample(LAND_GRID, landFracCache, lon, lat);
}

// ---------------------------------------------------------------------------
// Steering flow

export interface SteeringContext {
  season: Season;
  real: Realization;
  wds: { lon: number; lat: number; amp: number }[];
}

export function steering(ctx: SteeringContext, lon: number, lat: number, t: number): [number, number] {
  const st = ctx.season.steering;
  let ridgeLat = st.ridgeLat;
  let ue = st.ue;
  let uw = st.uw;
  let vBias = st.vBias;
  let width = st.width;
  if (st.west) {
    const x = Math.max(0, Math.min(1, (lon - 71) / 8));
    const wW = 1 - x * x * (3 - 2 * x);
    ridgeLat += wW * ((st.west.ridgeLat ?? st.ridgeLat) - st.ridgeLat);
    ue += wW * ((st.west.ue ?? st.ue) - st.ue);
    uw += wW * ((st.west.uw ?? st.uw) - st.uw);
    vBias += wW * ((st.west.vBias ?? st.vBias) - st.vBias);
    width += wW * ((st.west.width ?? st.width) - st.width);
  }
  const ridge =
    ridgeLat + (st.slope * (lon - 80)) / 10 + st.amp * Math.sin((2 * Math.PI * t) / st.period + ctx.real.ridgePhase) + ctx.real.ridgeShift;
  const y = (lat - ridge) / width;
  let u = y >= 0 ? uw * Math.tanh(y) : ue * Math.tanh(y);
  let v = vBias;
  for (const wd of ctx.wds) {
    const ax = ((lon - wd.lon) * Math.cos((lat * Math.PI) / 180)) / 6;
    const ay = (lat - wd.lat) / 9;
    const amp = (wd.amp / 100) * 5;
    v += 2.3 * amp * ax * Math.exp(-(ax * ax + ay * ay));
    u += 0.6 * amp * Math.exp(-(ax * ax + ay * ay)) * (ay < 0 ? 1 : 0.4);
  }
  u *= ctx.real.steerMult;
  v *= ctx.real.steerMult;
  if (ctx.real.steerRotate) {
    const a = (ctx.real.steerRotate * Math.PI) / 180;
    const ur = u * Math.cos(a) - v * Math.sin(a);
    v = u * Math.sin(a) + v * Math.cos(a);
    u = ur;
  }
  return [u, v];
}

// ---------------------------------------------------------------------------
// Simulation

interface Live {
  id: number;
  kind: SysKind;
  lon: number;
  lat: number;
  v: number;
  amp: number;
  rmax: number;
  roci: number;
  size: number;
  b: number;
  rainEff: number;
  growth: number;
  life: number;
  age: number;
  landHours: number;
  weakHours: number;
  ouU: number;
  ouV: number;
  ouI: number;
  cu: number;
  cv: number;
  land: number;
  t0: number;
  alive: boolean;
  parent?: { id: number; relation: SysRelation };
  mergedInto?: { id: number; t: number };
  truthId?: number;
  spurious?: boolean;
  rec: { lon: number[]; lat: number[]; v: number[]; rmax: number[]; roci: number[]; cu: number[]; cv: number[]; land: number[]; ouU: number[]; ouV: number[] };
}

function newRec(): Live['rec'] {
  return { lon: [], lat: [], v: [], rmax: [], roci: [], cu: [], cv: [], land: [], ouU: [], ouV: [] };
}

function rmaxTarget(kind: SysKind, v: number, size: number): number {
  if (kind === 'mlow') return 170 * size;
  return Math.max(15, Math.min(140, 18 + 110 * Math.exp(-(v - 15) / 30))) * size;
}

function rociTarget(kind: SysKind, v: number, size: number, age: number): number {
  if (kind === 'mlow') return Math.min(1100, (650 + 6 * v) * size);
  return Math.min(1100, (330 + 4.2 * v) * size * (1 + Math.min(0.5, 0.004 * age)));
}

function makeLive(sp: Spawn, t: number, lon: number, lat: number, v: number, rng: Rng): Live {
  const isVortex = sp.kind === 'tc' || sp.kind === 'mlow';
  const live: Live = {
    id: sp.id,
    kind: sp.kind,
    lon,
    lat,
    v: isVortex ? v : 0,
    amp: isVortex ? 0 : v,
    rmax: 0,
    roci: 0,
    size: sp.size,
    b: sp.kind === 'mlow' ? 1.0 : 1.25,
    rainEff: rng.range(0.85, 1.2),
    growth: sp.growth,
    life: sp.life,
    age: 0,
    landHours: 0,
    weakHours: 0,
    ouU: 0,
    ouV: 0,
    ouI: 0,
    cu: 0,
    cv: 0,
    land: landFracAt(lon, lat),
    t0: t,
    alive: true,
    rec: newRec(),
  };
  if (isVortex) {
    live.rmax = rmaxTarget(sp.kind, v, sp.size);
    live.roci = rociTarget(sp.kind, v, sp.size, 0);
  } else if (sp.kind === 'wd') {
    live.rmax = 520 * sp.size;
    live.roci = 1400 * sp.size;
  } else if (sp.kind === 'heat') {
    live.rmax = 520 * sp.size;
    live.roci = 900 * sp.size;
  } else if (sp.kind === 'cold') {
    live.rmax = 600 * sp.size;
    live.roci = 1000 * sp.size;
  } else {
    live.rmax = 75 * sp.size;
    live.roci = 180 * sp.size;
  }
  return live;
}

export interface SimInput {
  season: Season;
  real: Realization;
  seedParts: (number | string)[];
  initial: Live[];
  spawns: Spawn[];
  tStart: number;
  tEnd: number;
}

function record(s: Live) {
  s.rec.lon.push(s.lon);
  s.rec.lat.push(s.lat);
  s.rec.v.push(s.kind === 'tc' || s.kind === 'mlow' ? s.v : currentAmp(s));
  s.rec.rmax.push(s.rmax);
  s.rec.roci.push(s.roci);
  s.rec.cu.push(s.cu);
  s.rec.cv.push(s.cv);
  s.rec.land.push(s.land);
  s.rec.ouU.push(s.ouU);
  s.rec.ouV.push(s.ouV);
}

function currentAmp(s: Live): number {
  const x = s.age / s.life;
  return x >= 1 ? 0 : s.amp * envelope(x) * (1 + 0.08 * s.ouI);
}

export function simulate(input: SimInput): SysHistory[] {
  const { season, real } = input;
  const rng = makeRng(...input.seedParts, 'sim');
  const live: Live[] = [...input.initial];
  const done: Live[] = [];
  const spawns = [...input.spawns].sort((a, b) => a.t - b.t);
  let si = 0;
  const dt = 1;

  for (let t = input.tStart; t <= input.tEnd; t += dt) {
    while (si < spawns.length && Math.round(spawns[si].t) <= t) {
      const sp = spawns[si++];
      if (Math.round(sp.t) < input.tStart) continue;
      let lon = sp.lon;
      let lat = sp.lat;
      let v = sp.v;
      if (sp.parent) {
        const p = live.find((s) => s.id === sp.parent!.id && s.alive);
        if (!p) continue;
        [lon, lat] = destination(p.lon, p.lat, sp.parent.bearing, sp.parent.km);
        if (sp.parent.relation === 'split') {
          v = Math.max(10, p.v * sp.parent.share);
          p.v *= 1 - 0.35 * sp.parent.share;
        }
      }
      const s = makeLive(sp, t, lon, lat, v, rng);
      if (sp.parent) s.parent = { id: sp.parent.id, relation: sp.parent.relation };
      live.push(s);
    }

    const wds = live
      .filter((s) => s.alive && s.kind === 'wd')
      .map((s) => ({ lon: s.lon, lat: s.lat, amp: currentAmp(s) }));
    const sctx: SteeringContext = { season, real, wds };

    for (const s of live) if (s.alive) record(s);
    if (t === input.tEnd) break;

    const vortices = live.filter((s) => s.alive && (s.kind === 'tc' || s.kind === 'mlow'));

    for (const s of live) {
      if (!s.alive) continue;
      s.ouU = ouStep(s.ouU, real.ouSigma, 24, dt, rng);
      s.ouV = ouStep(s.ouV, real.ouSigma, 24, dt, rng);
      s.ouI = ouStep(s.ouI, 1, 18, dt, rng);

      if (s.kind === 'tc' || s.kind === 'mlow') stepVortex(s, sctx, vortices, t, rng);
      else stepOther(s, sctx, t);

      s.age += dt;
      s.land = landFracAt(s.lon, s.lat);
      if (s.lon < 46 || s.lon > 104 || s.lat < -4 || s.lat > 44) s.alive = false;
    }

    // Binary interaction: absorb the weaker of two close vortices.
    for (let a = 0; a < vortices.length; a++) {
      for (let b = a + 1; b < vortices.length; b++) {
        const A = vortices[a];
        const B = vortices[b];
        if (!A.alive || !B.alive) continue;
        const d = distKm(A.lon, A.lat, B.lon, B.lat);
        if (d > 170) continue;
        const [strong, weak] = A.v >= B.v ? [A, B] : [B, A];
        if (weak.v > 0.8 * strong.v && d > 90) continue;
        weak.alive = false;
        weak.mergedInto = { id: strong.id, t: t + dt };
        strong.v += 0.12 * weak.v;
        strong.roci = Math.min(1150, strong.roci * 1.08);
      }
    }

    for (let k = live.length - 1; k >= 0; k--) {
      if (!live[k].alive) {
        done.push(live[k]);
        live.splice(k, 1);
      }
    }
  }
  return [...done, ...live].filter((s) => s.rec.lon.length > 0).map(toHistory);
}

function stepVortex(s: Live, sctx: SteeringContext, vortices: Live[], t: number, rng: Rng) {
  const { season, real } = sctx;
  const [us, vs] = steering(sctx, s.lon, s.lat, t);
  let bu = 0;
  let bv = 0;
  if (s.kind === 'tc') {
    const beta = Math.min(1.25, 0.45 + s.roci / 1100);
    bu = -0.9 * beta;
    bv = 1.6 * beta;
  } else {
    bu = -0.5;
    bv = 0.7;
  }
  // Binary interaction (Fujiwhara): cyclonic rotation about, and drift towards, the neighbour.
  let iu = 0;
  let iv = 0;
  for (const o of vortices) {
    if (o === s || !o.alive) continue;
    const d = distKm(s.lon, s.lat, o.lon, o.lat);
    if (d > 1300 || d < 1) continue;
    const vo = hollandWind(o.v, o.rmax, o.b, d) * 0.5144;
    const brg = (bearingDeg(o.lon, o.lat, s.lon, s.lat) * Math.PI) / 180;
    const rx = Math.sin(brg);
    const ry = Math.cos(brg);
    iu += 0.3 * vo * -ry - 0.12 * vo * rx;
    iv += 0.3 * vo * rx - 0.12 * vo * ry;
  }
  s.cu = us + bu + iu + s.ouU;
  s.cv = vs + bv + iv + s.ouV;
  [s.lon, s.lat] = advect(s.lon, s.lat, s.cu, s.cv, 1);

  // Intensity
  const land = landFracAt(s.lon, s.lat);
  const env = envAt(season, s.lon, s.lat);
  const basinDelta = s.lon >= 78.3 ? real.sstDeltaBay : real.sstDeltaArb;
  const sst = env.sst + real.sstDelta + basinDelta;
  const shear = env.shear * real.shearMult;
  const rh = Math.max(0.1, Math.min(0.95, env.rh + real.rhDelta));
  const shearPen = Math.max(0, Math.min(0.85, (shear - 8) / 28));
  const moist = Math.max(0, Math.min(1, (rh - 0.4) / 0.35));
  const speed = Math.hypot(s.cu, s.cv);
  const upwelling = speed < 3 ? 0.84 + 0.05 * speed : 1;
  let mpiEff = mpiKt(sst) * real.intensityBias * (1 - shearPen) * (0.5 + 0.5 * moist) * (1 + 0.12 * real.mjo) * upwelling;
  if (sst < 26) mpiEff *= Math.max(0, (sst - 23) / 3);
  // Monsoon lows live in strong easterly shear: they rarely get past deep depression.
  if (s.kind === 'mlow') mpiEff = Math.min(mpiEff, 33);

  const growth = s.growth * real.growthMult * (1 + 0.15 * real.mjo);
  let dvSea: number;
  if (s.v < mpiEff) dvSea = growth * Math.sqrt(Math.max(s.v, 6)) * (1 - s.v / Math.max(1, mpiEff));
  else dvSea = -0.05 * (s.v - mpiEff);

  const elev = land > 0.3 ? elevationAt(s.lon, s.lat) : 0;
  let dvLand: number;
  if (s.kind === 'tc') {
    const alpha = 0.095 * (1 - 0.6 * real.brownOcean) * (elev > 600 ? 1.5 : 1);
    const floor = 12 * Math.exp(-s.landHours / 42);
    dvLand = -alpha * (s.v - floor);
  } else {
    const alpha = 0.014 * (1 - 0.5 * real.brownOcean) * (elev > 800 ? 2.2 : 1);
    const floor = 14 * Math.exp(-s.landHours / 110);
    dvLand = -alpha * (s.v - floor) + (rh > 0.65 ? 0.03 : 0);
  }
  const dv = land * dvLand + (1 - land) * dvSea + 0.3 * s.ouI * (s.kind === 'tc' ? 1 : 0.5);
  s.v = Math.max(3, s.v + dv);
  s.landHours = land > 0.5 ? s.landHours + 1 : Math.max(0, s.landHours - 2);

  // Structure
  const rT = rmaxTarget(s.kind, s.v, s.size) * (land > 0.5 ? 1.5 : 1);
  s.rmax += (rT - s.rmax) / 12;
  const oT = rociTarget(s.kind, s.v, s.size, s.age) * (land > 0.5 ? 0.9 : 1);
  s.roci += (oT - s.roci) / 18;
  s.b = s.kind === 'mlow' ? 1.0 : 1.15 + 0.0065 * s.v;

  if (s.v < 9) s.weakHours++;
  else s.weakHours = 0;
  if (s.weakHours > 6) s.alive = false;
  void rng;
}

function stepOther(s: Live, sctx: SteeringContext, t: number) {
  if (s.age >= s.life) {
    s.alive = false;
    return;
  }
  if (s.kind === 'wd') {
    const [us] = steering(sctx, s.lon, s.lat, t);
    s.cu = 0.9 * Math.max(4, us) + 0.5 * s.ouU;
    s.cv = 0.15 * s.ouV;
  } else if (s.kind === 'heat') {
    s.cu = 0.7 + 0.5 * s.ouU;
    s.cv = 0.15 + 0.4 * s.ouV;
  } else if (s.kind === 'cold') {
    s.cu = 0.8 + 0.4 * s.ouU;
    s.cv = -0.5 + 0.3 * s.ouV;
  } else {
    const [ul, vl] = rbfVec(sctx.season.wind, s.lon, s.lat);
    const [us, vs] = steering(sctx, s.lon, s.lat, t);
    s.cu = 0.6 * ul + 0.35 * us + 0.8 * s.ouU;
    s.cv = 0.6 * vl + 0.35 * vs + 0.8 * s.ouV;
  }
  [s.lon, s.lat] = advect(s.lon, s.lat, s.cu, s.cv, 1);
}

function toHistory(s: Live): SysHistory {
  const f = (a: number[]) => Float32Array.from(a);
  return {
    id: s.id,
    kind: s.kind,
    t0: s.t0,
    lon: f(s.rec.lon),
    lat: f(s.rec.lat),
    v: f(s.rec.v),
    rmax: f(s.rec.rmax),
    roci: f(s.rec.roci),
    cu: f(s.rec.cu),
    cv: f(s.rec.cv),
    land: f(s.rec.land),
    ouU: f(s.rec.ouU),
    ouV: f(s.rec.ouV),
    b: s.b,
    rainEff: s.rainEff,
    parent: s.parent,
    mergedInto: s.mergedInto,
    truthId: s.truthId,
    spurious: s.spurious,
  };
}

/** State of a system at an integer hour, or null if it does not exist then. */
export function stateAt(h: SysHistory, t: number) {
  const k = Math.round(t) - h.t0;
  if (k < 0 || k >= h.lon.length) return null;
  return {
    id: h.id,
    kind: h.kind,
    lon: h.lon[k],
    lat: h.lat[k],
    v: h.v[k],
    rmax: h.rmax[k],
    roci: h.roci[k],
    cu: h.cu[k],
    cv: h.cv[k],
    land: h.land[k],
    b: h.kind === 'mlow' ? 1.0 : 1.15 + 0.0065 * h.v[k],
    rainEff: h.rainEff,
    age: k,
  };
}

export type SysState = NonNullable<ReturnType<typeof stateAt>>;

export function lastT(h: SysHistory): number {
  return h.t0 + h.lon.length - 1;
}

// ---------------------------------------------------------------------------
// Season scripts: which systems exist, roughly where and when they form.

function poisson(rng: Rng, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > L);
  return k - 1;
}

interface ScriptCtx {
  rng: Rng;
  spawns: Spawn[];
  nextId: number;
  tStart: number;
  tEnd: number;
}

function add(ctx: ScriptCtx, sp: Omit<Spawn, 'id'>): Spawn {
  const s = { ...sp, id: ctx.nextId++ };
  ctx.spawns.push(s);
  return s;
}

function tc(ctx: ScriptCtx, t: number, lon: number, lat: number, growth: number, size = 1): Spawn {
  return add(ctx, { t, kind: 'tc', lon, lat, v: 12, size, growth, life: 9999 });
}

function mlow(ctx: ScriptCtx, t: number, lon: number, lat: number, growth: number, size = 1): Spawn {
  return add(ctx, { t, kind: 'mlow', lon, lat, v: 12, size, growth, life: 9999 });
}

function convective(ctx: ScriptCtx, box: [number, number, number, number], perDay: number, hours: [number, number], peak: [number, number]) {
  const { rng } = ctx;
  for (let day = Math.ceil(ctx.tStart / 24); day * 24 < ctx.tEnd; day++) {
    const n = poisson(rng, perDay);
    for (let k = 0; k < n; k++) {
      add(ctx, {
        t: day * 24 + rng.range(hours[0], hours[1]),
        kind: 'conv',
        lon: rng.range(box[0], box[2]),
        lat: rng.range(box[1], box[3]),
        v: rng.range(peak[0], peak[1]),
        size: rng.range(0.6, 1.5),
        growth: 0,
        life: rng.range(8, 20),
      });
    }
  }
}

function wd(ctx: ScriptCtx, t: number, lon: number, lat: number, amp: number): Spawn {
  const { rng } = ctx;
  return add(ctx, { t, kind: 'wd', lon, lat, v: amp, size: rng.range(0.85, 1.2), growth: 0, life: rng.range(110, 170) });
}

function induced(ctx: ScriptCtx, parent: Spawn, delay: number, km: number, bearing: number) {
  return add(ctx, {
    t: parent.t + delay,
    kind: 'mlow',
    lon: 0,
    lat: 0,
    v: 11,
    size: 0.55,
    growth: 0.05,
    life: 9999,
    parent: { id: parent.id, relation: 'induced', km, bearing, share: 0 },
  });
}

const SCRIPTS: Record<SeasonId, (ctx: ScriptCtx) => void> = {
  postmonsoon(ctx) {
    const { rng } = ctx;
    tc(ctx, rng.range(-78, -30), rng.range(88.5, 94.5), rng.range(7.5, 11.5), rng.range(0.19, 0.27));
    if (rng.chance(0.55)) tc(ctx, rng.range(50, 150), rng.range(85.5, 93), rng.range(6, 10), rng.range(0.12, 0.2));
    if (rng.chance(0.65)) tc(ctx, rng.range(-36, 96), rng.range(68.5, 73), rng.range(9, 14), rng.range(0.1, 0.19));
    if (rng.chance(0.8)) {
      const w1 = wd(ctx, rng.range(-80, 60), rng.range(54, 61), rng.range(32, 36), rng.range(60, 110));
      if (rng.chance(0.45)) induced(ctx, w1, rng.range(30, 54), rng.range(650, 900), rng.range(150, 185));
    }
    convective(ctx, [75, 8, 80.5, 13], 1.1, [6, 13], [28, 60]);
    convective(ctx, [79.5, 6, 82, 9.8], 0.5, [6, 14], [25, 50]);
  },
  monsoon(ctx) {
    const { rng } = ctx;
    const dep = mlow(ctx, rng.range(-54, 6), rng.range(88.5, 91), rng.range(17.5, 19.5), rng.range(0.15, 0.2), rng.range(0.9, 1.2));
    if (rng.chance(0.6)) mlow(ctx, rng.range(40, 130), rng.range(87, 90), rng.range(18, 20.5), rng.range(0.12, 0.18));
    if (rng.chance(0.5)) {
      add(ctx, {
        t: dep.t + rng.range(60, 96),
        kind: 'mlow',
        lon: 0,
        lat: 0,
        v: 12,
        size: 0.8,
        growth: 0.07,
        life: 9999,
        parent: { id: dep.id, relation: 'split', km: rng.range(330, 450), bearing: rng.range(205, 255), share: 0.6 },
      });
    }
    if (rng.chance(0.4)) mlow(ctx, dep.t + rng.range(30, 70), rng.range(79, 82), rng.range(21.5, 24), 0.06, 0.8);
    if (rng.chance(0.3)) mlow(ctx, rng.range(-40, 100), rng.range(69.5, 71.5), rng.range(17, 20), 0.07, 0.5);
    if (rng.chance(0.3)) wd(ctx, rng.range(-60, 80), rng.range(56, 62), rng.range(35, 37), rng.range(40, 70));
    convective(ctx, [76, 19, 87, 25], 1.6, [8, 15], [30, 70]);
    convective(ctx, [89, 22, 94, 27], 1.0, [6, 14], [35, 75]);
    convective(ctx, [73, 10, 76, 19], 0.8, [6, 14], [30, 60]);
  },
  premonsoon(ctx) {
    const { rng } = ctx;
    tc(ctx, rng.range(-84, -24), rng.range(86, 90.5), rng.range(8, 12), rng.range(0.22, 0.3));
    if (rng.chance(0.5)) tc(ctx, rng.range(-24, 90), rng.range(70.5, 73.5), rng.range(10, 13), rng.range(0.15, 0.24));
    add(ctx, { t: rng.range(-110, -40), kind: 'heat', lon: rng.range(72, 76), lat: rng.range(25, 28), v: rng.range(5, 7), size: rng.range(0.9, 1.2), growth: 0, life: rng.range(150, 230) });
    if (rng.chance(0.7)) add(ctx, { t: rng.range(-60, 60), kind: 'heat', lon: rng.range(77.5, 80), lat: rng.range(17.5, 21), v: rng.range(4.5, 6), size: rng.range(0.7, 1.0), growth: 0, life: rng.range(110, 170) });
    if (rng.chance(0.6)) {
      const w1 = wd(ctx, rng.range(-60, 80), rng.range(55, 61), rng.range(33, 36), rng.range(60, 100));
      if (rng.chance(0.3)) induced(ctx, w1, rng.range(30, 50), rng.range(650, 900), rng.range(150, 185));
    }
    convective(ctx, [85, 21, 92.5, 26.5], 2.2, [9, 15], [30, 75]);
    convective(ctx, [75.5, 8.5, 78, 12.5], 0.6, [7, 13], [25, 50]);
  },
  winter(ctx) {
    const { rng } = ctx;
    let t = rng.range(-130, -90);
    const n = rng.int(3, 4);
    for (let k = 0; k < n && t < ctx.tEnd - 48; k++) {
      const lon0 = rng.range(52, 58);
      const w1 = wd(ctx, t, lon0, rng.range(31, 35.5), rng.range(80, 140));
      if (rng.chance(0.5)) induced(ctx, w1, rng.range(36, 60), rng.range(650, 950), rng.range(145, 180));
      // Cold northwesterlies set in once the trough has passed north-west India.
      add(ctx, {
        t: t + ((75 - lon0) * 100) / 30 + rng.range(18, 36),
        kind: 'cold',
        lon: rng.range(74.5, 78.5),
        lat: rng.range(28.5, 31),
        v: rng.range(5, 7.5),
        size: rng.range(0.8, 1.15),
        growth: 0,
        life: rng.range(72, 110),
      });
      t += rng.range(70, 100);
    }
    if (rng.chance(0.4)) tc(ctx, rng.range(-40, 100), rng.range(82, 86), rng.range(6, 9), 0.08);
    convective(ctx, [79, 6, 81.8, 10], 0.4, [6, 12], [20, 40]);
  },
};

export function makeWorld(season: SeasonId, seed: number, analysis: number): World {
  const rng = makeRng(seed, season, 'script');
  const ctx: ScriptCtx = { rng, spawns: [], nextId: 1, tStart: TRUTH_START, tEnd: TRUTH_END };
  SCRIPTS[season](ctx);
  const ridgePhase = makeRng(seed, season, 'ridge').range(0, Math.PI * 2);
  const real: Realization = { ...BASE_REALIZATION, stream: 'truth', ridgePhase };
  const truth = simulate({
    season: SEASONS[season],
    real,
    seedParts: [seed, season, 'truth'],
    initial: [],
    spawns: ctx.spawns,
    tStart: TRUTH_START,
    tEnd: TRUTH_END,
  });
  return { season, seed, analysis, ridgePhase, spawns: ctx.spawns, truth, tStart: TRUTH_START, tEnd: TRUTH_END };
}

// ---------------------------------------------------------------------------
// Forecasts: deterministic run, ensemble members and scenarios all start from
// the truth at the initial time (with analysis error) and evolve with their own
// noise, model error and, for scenarios, altered environment.

export interface ScenarioParams {
  sstDelta: number;
  sstDeltaBay: number;
  sstDeltaArb: number;
  shearMult: number;
  rhDelta: number;
  ridgeShift: number;
  steerMult: number;
  mjo: number;
  brownOcean: number;
}

export const NEUTRAL_SCENARIO: ScenarioParams = {
  sstDelta: 0,
  sstDeltaBay: 0,
  sstDeltaArb: 0,
  shearMult: 1,
  rhDelta: 0,
  ridgeShift: 0,
  steerMult: 1,
  mjo: 0,
  brownOcean: 0,
};

export type ForecastKind = { type: 'det' } | { type: 'member'; member: number } | { type: 'scenario'; params: ScenarioParams; key: string };

export function forecastRealization(world: World, init: number, kind: ForecastKind): Realization {
  const base = { ...BASE_REALIZATION, ridgePhase: world.ridgePhase };
  // Model error shared by every forecast from this initial time.
  const m = makeRng(world.seed, world.season, 'model', init);
  const modelRidge = m.normal(0, 0.45);
  const modelSteer = 1 + m.normal(0, 0.04);
  if (kind.type === 'det') {
    return { ...base, stream: `det:${init}`, ridgeShift: modelRidge, steerMult: modelSteer, intensityBias: 0.95 };
  }
  if (kind.type === 'scenario') {
    const p = kind.params;
    return {
      ...base,
      stream: `det:${init}`,
      ridgeShift: modelRidge + p.ridgeShift,
      steerMult: modelSteer * p.steerMult,
      intensityBias: 0.95,
      sstDelta: p.sstDelta,
      sstDeltaBay: p.sstDeltaBay,
      sstDeltaArb: p.sstDeltaArb,
      shearMult: p.shearMult,
      rhDelta: p.rhDelta,
      mjo: p.mjo,
      brownOcean: p.brownOcean,
    };
  }
  const r = makeRng(world.seed, world.season, 'member', init, kind.member);
  if (kind.member === 0) return { ...base, stream: `mem:${init}:0`, ridgeShift: modelRidge, steerMult: modelSteer, intensityBias: 0.95 };
  return {
    ...base,
    stream: `mem:${init}:${kind.member}`,
    ridgeShift: modelRidge + r.normal(0, 0.9),
    ridgePhase: world.ridgePhase + r.normal(0, 0.25),
    steerMult: modelSteer * (1 + r.normal(0, 0.08)),
    steerRotate: r.normal(0, 6),
    sstDelta: r.normal(0, 0.3),
    shearMult: 1 + r.normal(0, 0.1),
    rhDelta: r.normal(0, 0.04),
    growthMult: 1 + r.normal(0, 0.12),
    intensityBias: 0.95 + r.normal(0, 0.03),
  };
}

export function runForecast(world: World, init: number, kind: ForecastKind, hours = 168): SysHistory[] {
  const season = SEASONS[world.season];
  const real = forecastRealization(world, init, kind);
  // Scenario runs share the deterministic run's noise so that differences come from the scenario alone.
  const streamKey = kind.type === 'scenario' ? 'det' : kind.type === 'det' ? 'det' : `m${kind.member}`;
  const rng = makeRng(world.seed, world.season, 'fc', init, streamKey);
  const isMember = kind.type === 'member' && kind.member > 0;

  const initial: Live[] = [];
  for (const h of world.truth) {
    const k = init - h.t0;
    if (k < 0 || k >= h.lon.length) continue;
    const posErr = isMember ? 32 : 20;
    const [lon, lat] = destination(h.lon[k], h.lat[k], rng.range(0, 360), Math.abs(rng.normal(0, posErr)));
    const isVortex = h.kind === 'tc' || h.kind === 'mlow';
    const sp = world.spawns.find((s) => s.id === h.id);
    const s: Live = {
      id: h.id,
      kind: h.kind,
      lon,
      lat,
      v: isVortex ? Math.max(5, h.v[k] + rng.normal(0, isMember ? 4 : 2.5)) : 0,
      amp: isVortex ? 0 : (sp?.v ?? h.v[k]),
      rmax: h.rmax[k] * (1 + rng.normal(0, 0.08)),
      roci: h.roci[k],
      size: sp?.size ?? 1,
      b: h.b,
      rainEff: h.rainEff,
      growth: sp?.growth ?? 0.15,
      life: sp?.life ?? 9999,
      age: k,
      landHours: 0,
      weakHours: 0,
      ouU: h.ouU[k] * 0.7,
      ouV: h.ouV[k] * 0.7,
      ouI: 0,
      cu: h.cu[k],
      cv: h.cv[k],
      land: h.land[k],
      t0: init,
      alive: true,
      truthId: h.id,
      parent: h.parent && h.t0 >= init ? h.parent : undefined,
      rec: newRec(),
    };
    initial.push(s);
  }

  const spawns: Spawn[] = [];
  for (const sp of world.spawns) {
    if (sp.t <= init || sp.t > init + hours) continue;
    const lead = sp.t - init;
    // Large-scale features (troughs, heat and cold domes) are far more predictable than cyclogenesis.
    const large = sp.kind === 'wd' || sp.kind === 'heat' || sp.kind === 'cold';
    const p = sp.parent ? (isMember ? 0.6 : 0.75) : large ? 0.96 : Math.max(0.3, Math.min(0.95, 0.95 - 0.005 * lead));
    if (sp.kind === 'conv') {
      spawns.push({ ...sp, t: Math.max(init + 1, sp.t + rng.normal(0, 2)), v: sp.v * rng.range(0.7, 1.2) });
      continue;
    }
    if (!rng.chance(p)) continue;
    const posErr = (isMember ? 90 : 60) * (1 + lead / 96);
    const [lon, lat] = destination(sp.lon, sp.lat, rng.range(0, 360), Math.abs(rng.normal(0, posErr)));
    const dt = large ? rng.normal(0, 4 * (1 + lead / 120)) : rng.normal(0, 8 * (1 + lead / 72));
    spawns.push({
      ...sp,
      t: Math.max(init + 1, sp.t + dt),
      lon: sp.parent ? sp.lon : large ? sp.lon + (lon - sp.lon) * 0.4 : lon,
      lat: sp.parent ? sp.lat : large ? sp.lat + (lat - sp.lat) * 0.4 : lat,
      growth: sp.growth * (1 + rng.normal(0, 0.1)),
    });
  }
  // Spurious genesis: models sometimes spin up a low that never forms.
  const falseAlarmP = isMember ? 0.12 : kind.type === 'member' ? 0 : 0.28;
  if (rng.chance(falseAlarmP)) {
    const bay = rng.chance(0.6);
    spawns.push({
      id: 900 + (kind.type === 'member' ? kind.member : 0),
      t: init + rng.range(24, 120),
      kind: world.season === 'monsoon' ? 'mlow' : 'tc',
      lon: bay ? rng.range(84, 92) : rng.range(64, 72),
      lat: bay ? rng.range(8, 17) : rng.range(9, 18),
      v: 11,
      size: rng.range(0.8, 1.1),
      growth: rng.range(0.06, 0.12),
      life: 9999,
    });
  }

  const hist = simulate({
    season,
    real,
    seedParts: [world.seed, world.season, 'fcsim', init, streamKey],
    initial,
    spawns,
    tStart: init,
    tEnd: init + hours,
  });
  for (const h of hist) {
    if (h.truthId === undefined) {
      if (h.id >= 900) h.spurious = true;
      else h.truthId = h.id;
    }
  }
  return hist;
}

/** Systems alive at time t, as instantaneous states. */
export function statesAt(hist: SysHistory[], t: number): SysState[] {
  const out: SysState[] = [];
  for (const h of hist) {
    const s = stateAt(h, t);
    if (s) out.push(s);
  }
  return out;
}
