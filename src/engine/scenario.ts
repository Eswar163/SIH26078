// Scenario Lab: re-run the forecast with a changed environment and explain
// the difference. Scenario runs share the deterministic run's noise, so every
// difference comes from the scenario itself. Attribution splits the change in
// each outcome among the changed factors with exact Shapley values (every
// on/off combination of the changed factors is simulated).

import { distKm } from './geo';
import { landInfo } from './land';
import { makeGrid, sample } from './grid';
import { coastPosition } from './places';
import { DET_GRID, publicTimes, runPipeline, type PipelineOutput } from './run';
import { NEUTRAL_SCENARIO, runForecast, statesAt, type ScenarioParams, type SysHistory, type World } from './world';
import type { EventTrack } from './events';

export type ScenarioKey = keyof ScenarioParams;

export const SCENARIO_FACTORS: { key: ScenarioKey; label: string; unit: string; min: number; max: number; step: number; neutral: number; hint: string }[] = [
  { key: 'sstDeltaBay', label: 'Bay of Bengal sea temperature', unit: '°C', min: -2, max: 3, step: 0.25, neutral: 0, hint: 'Warmer water raises the ceiling on intensity.' },
  { key: 'sstDeltaArb', label: 'Arabian Sea sea temperature', unit: '°C', min: -2, max: 3, step: 0.25, neutral: 0, hint: 'Warmer water raises the ceiling on intensity.' },
  { key: 'shearMult', label: 'Vertical wind shear', unit: '×', min: 0.4, max: 2, step: 0.05, neutral: 1, hint: 'Strong shear tilts and weakens a cyclone.' },
  { key: 'rhDelta', label: 'Mid-level humidity', unit: '', min: -0.25, max: 0.15, step: 0.01, neutral: 0, hint: 'Dry air intrusion chokes the core.' },
  { key: 'ridgeShift', label: 'Subtropical ridge position', unit: '° lat', min: -4, max: 4, step: 0.25, neutral: 0, hint: 'A ridge further north keeps systems moving west for longer.' },
  { key: 'steerMult', label: 'Steering flow strength', unit: '×', min: 0.5, max: 1.6, step: 0.05, neutral: 1, hint: 'Weak steering means slow, stalling systems.' },
  { key: 'mjo', label: 'Madden-Julian Oscillation', unit: '', min: -1, max: 1, step: 0.1, neutral: 0, hint: 'An active MJO phase over the Indian Ocean favours cyclogenesis.' },
  { key: 'brownOcean', label: 'Wet soil after landfall', unit: '', min: 0, max: 1, step: 0.05, neutral: 0, hint: 'Saturated land slows the decay of a landfalling system.' },
];

export const SCENARIO_PRESETS: { id: string; label: string; params: Partial<ScenarioParams>; note: string }[] = [
  { id: 'warm-bay', label: 'Warmer Bay', params: { sstDeltaBay: 1.5 }, note: 'Bay of Bengal 1.5 °C warmer than the model analysis.' },
  { id: 'north-ridge', label: 'Ridge further north', params: { ridgeShift: 2.5 }, note: 'Subtropical ridge 2.5° further north.' },
  { id: 'south-ridge', label: 'Ridge further south', params: { ridgeShift: -2.5 }, note: 'Earlier recurvature under westerlies.' },
  { id: 'dry-shear', label: 'Dry, sheared', params: { rhDelta: -0.15, shearMult: 1.5 }, note: 'Dry air intrusion with 50% more shear.' },
  { id: 'mjo-active', label: 'MJO active', params: { mjo: 1 }, note: 'Convectively active MJO phase over the Indian Ocean.' },
  { id: 'stall-wet', label: 'Slow and soggy landfall', params: { steerMult: 0.6, brownOcean: 0.8 }, note: 'Weak steering and saturated soil: a long, wet landfall.' },
];

export function scenarioKey(p: ScenarioParams): string {
  return (Object.keys(NEUTRAL_SCENARIO) as ScenarioKey[]).map((k) => `${k}=${p[k]}`).join('&');
}

export function changedFactors(p: ScenarioParams): ScenarioKey[] {
  return (Object.keys(NEUTRAL_SCENARIO) as ScenarioKey[]).filter((k) => Math.abs(p[k] - NEUTRAL_SCENARIO[k]) > 1e-9);
}

export function runScenario(world: World, params: ScenarioParams, keepFields: boolean): PipelineOutput {
  const fc = runForecast(world, 0, { type: 'scenario', params, key: scenarioKey(params) });
  const source = (h: number) => (h <= 0 ? statesAt(world.truth, h) : statesAt(fc, h));
  return runPipeline({ world, grid: DET_GRID, times: publicTimes(-24, 168), source, keepFields });
}

/** Find the scenario event that corresponds to a baseline event. */
export function matchEvent(base: EventTrack, candidates: EventTrack[]): EventTrack | null {
  let best: { e: EventTrack; d: number } | null = null;
  for (const e of candidates) {
    if (e.kind !== base.kind) continue;
    if (base.truthId !== undefined && e.truthId === base.truthId) return e;
    let s = 0;
    let n = 0;
    for (const p of e.points) {
      const q = base.points.find((x) => x.t === p.t);
      if (!q) continue;
      s += distKm(p.lon, p.lat, q.lon, q.lat);
      if (++n >= 4) break;
    }
    if (!n) continue;
    const d = s / n;
    if (d < 500 && (!best || d < best.d)) best = { e, d };
  }
  return best?.e ?? null;
}

// ---------------------------------------------------------------------------
// System-level outcome metrics (fast; used for attribution)

export interface Outcome {
  peak: number;
  landfallArc: number | null;
  landfallTime: number | null;
  landfallWind: number | null;
  rainIndex: number;
  pos72: [number, number] | null;
}

const LG = makeGrid(0.25);

export function outcomeOf(h: SysHistory | undefined): Outcome | null {
  if (!h) return null;
  const frac = landInfo(LG).frac;
  let peak = 0;
  let rain = 0;
  let landfallArc: number | null = null;
  let landfallTime: number | null = null;
  let landfallWind: number | null = null;
  let pos72: [number, number] | null = null;
  let prevLand = true;
  for (let k = 0; k < h.lon.length; k++) {
    const t = h.t0 + k;
    if (t < 0) continue;
    peak = Math.max(peak, h.v[k]);
    const land = sample(LG, frac, h.lon[k], h.lat[k]) > 0.5;
    if (land) rain += (12 + 0.9 * h.v[k]) / 6;
    if (k > 0 && !prevLand && land && landfallArc === null) {
      const cp = coastPosition(h.lon[k], h.lat[k]);
      landfallArc = cp.dist < 200 ? cp.arcKm : null;
      landfallTime = t;
      landfallWind = h.v[k];
    }
    prevLand = land;
    if (t === 72) pos72 = [h.lon[k], h.lat[k]];
  }
  return { peak, landfallArc, landfallTime, landfallWind, rainIndex: rain, pos72 };
}

export interface Attribution {
  metric: 'peak' | 'landfallArc' | 'landfallTime' | 'rainIndex';
  label: string;
  unit: string;
  base: number | null;
  scenario: number | null;
  contributions: { key: ScenarioKey; label: string; value: number }[];
}

export function attribute(world: World, params: ScenarioParams, truthId: number): Attribution[] {
  const keys = changedFactors(params).slice(0, 6);
  const m = keys.length;
  const outcomes = new Map<number, Outcome | null>();
  for (let mask = 0; mask < 1 << m; mask++) {
    const p: ScenarioParams = { ...NEUTRAL_SCENARIO };
    keys.forEach((k, i) => {
      if (mask & (1 << i)) p[k] = params[k];
    });
    const fc = runForecast(world, 0, { type: 'scenario', params: p, key: scenarioKey(p) });
    outcomes.set(mask, outcomeOf(fc.find((h) => h.id === truthId)));
  }
  const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
  const metrics: { metric: Attribution['metric']; label: string; unit: string }[] = [
    { metric: 'peak', label: 'Peak intensity', unit: 'kt' },
    { metric: 'landfallArc', label: 'Landfall position along the coast', unit: 'km' },
    { metric: 'landfallTime', label: 'Landfall time', unit: 'h' },
    { metric: 'rainIndex', label: 'Rain over land (index)', unit: '' },
  ];
  return metrics.map(({ metric, label, unit }) => {
    const val = (mask: number) => {
      const o = outcomes.get(mask);
      const v = o ? o[metric] : null;
      return typeof v === 'number' ? v : null;
    };
    const base = val(0);
    const scen = val((1 << m) - 1);
    const contributions = keys.map((key, i) => {
      let phi = 0;
      let valid = true;
      for (let mask = 0; mask < 1 << m; mask++) {
        if (mask & (1 << i)) continue;
        const a = val(mask);
        const b = val(mask | (1 << i));
        if (a === null || b === null) {
          valid = false;
          continue;
        }
        const size = popcount(mask);
        phi += ((fact(size) * fact(m - size - 1)) / fact(m)) * (b - a);
      }
      const f = SCENARIO_FACTORS.find((x) => x.key === key)!;
      return { key, label: f.label, value: valid ? phi : NaN };
    });
    return { metric, label, unit, base, scenario: scen, contributions };
  });
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    c += x & 1;
    x >>= 1;
  }
  return c;
}
