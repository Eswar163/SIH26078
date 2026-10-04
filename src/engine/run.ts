// The pipeline: systems -> fields -> detections -> tracks -> events.
// Used for the deterministic run (with fields kept for the map), the previous
// runs, every ensemble member and every scenario.

import type { SeasonId } from './climate';
import { detectCold, detectCyclones, detectHeat, detectRain, detectStorms, detectWDs, type Detection, type DetectStatics, type EventKind } from './detect';
import { enrich, type EventTrack } from './events';
import { accumulate, makeGrid, type GridSpec } from './grid';
import { makeSynthContext, staticFields, synthesize, type FieldSet } from './synth';
import { inferLineage, pruneTracks, trackAreal, trackVortices, type RawTrack, type Relation } from './track';
import { distKm } from './geo';
import { makeWorld, runForecast, statesAt, type ForecastKind, type SysHistory, type SysState, type World } from './world';

export const STEP = 6;
export const PAST_HOURS = 72;
export const FORECAST_HOURS = 168;
const SPINUP = 18;

export interface RunConfig {
  season: SeasonId;
  seed: number;
  analysis: number;
}

export interface PipelineOptions {
  world: World;
  grid: GridSpec;
  /** Public times (hours). */
  times: number[];
  source: (h: number) => SysState[];
  keepFields: boolean;
  kinds?: EventKind[];
  noiseDrift?: number;
  noiseOrigin?: number;
  /** Called with each time step's fields (for ensemble probability products). */
  onFields?: (f: FieldSet, rain24: Float32Array) => void;
  onProgress?: (done: number, total: number) => void;
}

export interface PipelineOutput {
  times: number[];
  fields: FieldSet[];
  detections: Detection[][];
  events: EventTrack[];
  relations: Relation[];
  statics: ReturnType<typeof staticFields>;
}

const ALL_KINDS: EventKind[] = ['cyclone', 'wd', 'rain', 'heat', 'cold', 'storm'];

export function runPipeline(o: PipelineOptions): PipelineOutput {
  const kinds = new Set(o.kinds ?? ALL_KINDS);
  const ctx = makeSynthContext(o.world.season, o.grid, o.world.seed, o.world.analysis, o.noiseDrift ?? 0, o.noiseOrigin ?? 0);
  const statics = staticFields(ctx);
  const st: DetectStatics = statics;
  const needRain = kinds.has('rain') || !!o.onFields;
  const first = o.times[0];
  const synthTimes: number[] = [];
  if (needRain) for (let t = first - SPINUP; t < first; t += STEP) synthTimes.push(t);
  synthTimes.push(...o.times);

  const fields: FieldSet[] = [];
  const recentRain: Float32Array[] = [];
  const detections: Detection[][] = [];
  let done = 0;
  for (const t of synthTimes) {
    const f = synthesize(ctx, t, o.source);
    recentRain.push(f.rain6);
    if (recentRain.length > 4) recentRain.shift();
    if (t < first) continue;
    const rain24 = accumulate(recentRain);
    const wds = kinds.has('wd') || kinds.has('cyclone') ? detectWDs(o.grid, f, st) : [];
    const cyc = kinds.has('cyclone') ? detectCyclones(o.grid, f, st, wds) : [];
    const step: Detection[] = [];
    if (kinds.has('wd')) step.push(...wds);
    step.push(...cyc);
    if (kinds.has('rain')) step.push(...detectRain(o.grid, rain24, t, st));
    if (kinds.has('heat')) step.push(...detectHeat(o.grid, f, st));
    if (kinds.has('cold')) step.push(...detectCold(o.grid, f, st));
    if (kinds.has('storm')) step.push(...detectStorms(o.grid, f, st, cyc));
    detections.push(step);
    o.onFields?.(f, rain24);
    if (o.keepFields) fields.push(f);
    o.onProgress?.(++done, o.times.length);
  }

  const relations: Relation[] = [];
  const raw: RawTrack[] = [];
  for (const kind of kinds) {
    const steps = detections.map((d) => d.filter((x) => x.kind === kind));
    if (kind === 'cyclone' || kind === 'wd') raw.push(...trackVortices(kind, steps, o.times));
    else raw.push(...trackAreal(kind, steps, o.times, relations));
  }
  const lastTime = o.times[o.times.length - 1];
  inferLineage(raw, relations, lastTime);
  const kept = pruneTracks(raw, relations);
  const events = enrich(kept, relations, {
    season: o.world.season,
    seed: o.world.seed,
    grid: o.grid,
    sst: statics.sst,
    shear: statics.shear,
    rh: statics.rh,
  });
  for (const d of detections) for (const x of d) delete x.cells;
  return { times: o.times, fields, detections, events, relations, statics };
}

export function publicTimes(from = -PAST_HOURS, to = FORECAST_HOURS): number[] {
  const out: number[] = [];
  for (let t = from; t <= to; t += STEP) out.push(t);
  return out;
}

// ---------------------------------------------------------------------------
// Truth ("what actually happened"), for reveal and verification

export interface TruthTrack {
  id: number;
  kind: 'cyclone' | 'wd' | 'heat' | 'cold';
  t: number[];
  lon: number[];
  lat: number[];
  v: number[];
}

export function truthTracks(world: World, from = -PAST_HOURS, to = FORECAST_HOURS): TruthTrack[] {
  const out: TruthTrack[] = [];
  for (const h of world.truth) {
    const kind = h.kind === 'tc' || h.kind === 'mlow' ? 'cyclone' : h.kind === 'wd' ? 'wd' : h.kind === 'heat' ? 'heat' : h.kind === 'cold' ? 'cold' : null;
    if (!kind) continue;
    const tr: TruthTrack = { id: h.id, kind, t: [], lon: [], lat: [], v: [] };
    for (let t = Math.ceil(Math.max(from, h.t0) / STEP) * STEP; t <= to; t += STEP) {
      const k = t - h.t0;
      if (k < 0 || k >= h.lon.length) continue;
      tr.t.push(t);
      tr.lon.push(round2(h.lon[k]));
      tr.lat.push(round2(h.lat[k]));
      tr.v.push(Math.round(h.v[k] * 10) / 10);
    }
    if (tr.t.length >= 2 && (kind !== 'cyclone' || Math.max(...tr.v) >= 12)) out.push(tr);
  }
  return out;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Attach the id of the truth system each tracked event most likely corresponds to. */
export function matchTruth(events: EventTrack[], truth: TruthTrack[]) {
  for (const ev of events) {
    if (ev.kind !== 'cyclone' && ev.kind !== 'wd') continue;
    let best: { id: number; d: number } | null = null;
    for (const tr of truth) {
      if (tr.kind !== ev.kind) continue;
      let s = 0;
      let n = 0;
      for (const p of ev.points) {
        const k = tr.t.indexOf(p.t);
        if (k < 0) continue;
        s += distKm(p.lon, p.lat, tr.lon[k], tr.lat[k]);
        n++;
      }
      if (n < 2) continue;
      const d = s / n;
      const limit = ev.kind === 'wd' ? 600 : 300;
      if (d < limit && (!best || d < best.d)) best = { id: tr.id, d };
    }
    if (best) ev.truthId = best.id;
  }
}

// ---------------------------------------------------------------------------
// Runs

export const DET_GRID = makeGrid(0.25);
export const ENS_GRID = makeGrid(0.5);

export interface DeterministicRun {
  config: RunConfig;
  world: World;
  forecast: SysHistory[];
  output: PipelineOutput;
  truth: TruthTrack[];
}

export function deterministicRun(config: RunConfig, onProgress?: (done: number, total: number) => void): DeterministicRun {
  const world = makeWorld(config.season, config.seed, config.analysis);
  const forecast = runForecast(world, 0, { type: 'det' });
  const source = (h: number) => (h <= 0 ? statesAt(world.truth, h) : statesAt(forecast, h));
  const output = runPipeline({ world, grid: DET_GRID, times: publicTimes(), source, keepFields: true, onProgress });
  const truth = truthTracks(world);
  matchTruth(output.events, truth);
  return { config, world, forecast, output, truth };
}

/** A forecast started at `init` hours (<= 0) relative to the current analysis time. */
export function forecastRun(world: World, init: number, kind: ForecastKind, grid: GridSpec, kinds?: EventKind[], keepFields = false, onFields?: PipelineOptions['onFields']) {
  const fc = runForecast(world, init, kind);
  const past = kind.type === 'det' && init === 0 ? 72 : 24;
  const source = (h: number) => (h <= init ? statesAt(world.truth, h) : statesAt(fc, h));
  const memberDrift = kind.type === 'member' && kind.member > 0 ? 0.004 * kind.member : 0;
  return runPipeline({
    world,
    grid,
    times: publicTimes(init - past, init + FORECAST_HOURS),
    source,
    keepFields,
    kinds,
    noiseDrift: memberDrift,
    noiseOrigin: init,
    onFields,
  });
}
