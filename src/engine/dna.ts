// Event DNA: a compact, comparable fingerprint of an event.
//
// strip    per-step traits normalised to 0..1 (a "genome browser" row per trait)
// genome   fixed-length summary vector, used for similarity and the event map
// code     a short readable genotype, e.g. "B1 VSCS R r3"
//
// The partial genome uses only the life so far (age-aligned), which is what
// makes analog forecasting possible: compare the first N hours of a live
// event with the first N hours of every remembered event.

import type { EventKind } from './detect';
import { distKm, headingDelta } from './geo';
import { catIndex, CYCLONE_SCALE } from './imd';
import type { TrackPoint } from './track';
import { motionOf } from './lifecycle';

export interface StripRow {
  key: string;
  label: string;
  values: number[];
}

export interface Genome {
  values: number[];
  labels: string[];
}

export interface DNA {
  strip: StripRow[];
  genome: Genome;
  code: string[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export const GENOME_LABELS: Record<EventKind, string[]> = {
  cyclone: [
    'Genesis latitude',
    'Genesis longitude',
    'Peak intensity',
    'Fastest 24 h gain',
    'Time to peak',
    'Duration',
    'Mean speed',
    'Straightness',
    'Rightward turning',
    'Peak size',
    'Rain intensity',
    'Landfall strength',
  ],
  wd: ['Entry latitude', 'Peak amplitude', 'Mean speed', 'Duration', 'Precipitation', 'Track latitude span'],
  rain: ['Peak 24 h rain', 'Peak area', 'Mean rain', 'Duration', 'Speed', 'Land share'],
  storm: ['Peak 6 h rain', 'Area', 'Duration', 'Speed', 'Land share', 'Latitude'],
  heat: ['Peak temperature', 'Mean departure', 'Peak area', 'Severe share', 'Duration', 'Latitude'],
  cold: ['Lowest minimum', 'Mean departure', 'Peak area', 'Severe share', 'Duration', 'Latitude'],
};

export const GENOME_WEIGHTS: Record<EventKind, number[]> = {
  cyclone: [1.5, 1.5, 1.2, 1.0, 0.8, 0.6, 1.0, 0.8, 0.9, 0.6, 0.6, 1.0],
  wd: [1, 1.2, 1, 0.8, 1, 0.6],
  rain: [1.2, 1, 1, 0.8, 0.6, 0.6],
  storm: [1.2, 1, 0.8, 0.6, 0.6, 1],
  heat: [1.2, 1.2, 1, 1, 0.8, 1],
  cold: [1.2, 1.2, 1, 1, 0.8, 1],
};

function stripFor(kind: EventKind, p: TrackPoint[]): StripRow[] {
  const { speed, heading } = motionOf(p);
  const turn = heading.map((h, i) => (i === 0 ? 0 : Math.abs(headingDelta(heading[i - 1], h))));
  const v24 = (i: number) => {
    const j = p.findIndex((q) => q.t === p[i].t - 24);
    const a = j >= 0 ? p[j] : p[0];
    const dt = p[i].t - a.t;
    return dt > 0 ? (((p[i].vmax ?? 0) - (a.vmax ?? 0)) / dt) * 24 : 0;
  };
  const row = (key: string, label: string, f: (q: TrackPoint, i: number) => number): StripRow => ({
    key,
    label,
    values: p.map((q, i) => Math.round(clamp01(f(q, i)) * 1000) / 1000),
  });
  switch (kind) {
    case 'cyclone':
      return [
        row('int', 'Intensity', (q) => (q.vmax ?? 0) / 130),
        row('depth', 'Depth', (q) => (q.depth ?? 0) / 70),
        row('size', 'Size', (q) => (q.roci ?? 0) / 700),
        row('rain', 'Rain', (q) => (q.rainMax ?? 0) / 120),
        row('speed', 'Speed', (_q, i) => speed[i] / 35),
        row('turn', 'Turning', (_q, i) => turn[i] / 60),
        row('trend', 'Trend', (_q, i) => (v24(i) + 40) / 80),
        row('land', 'Over land', (q) => (q.overLand ? 1 : 0)),
      ];
    case 'wd':
      return [
        row('amp', 'Amplitude', (q) => (q.amp ?? 0) / 150),
        row('rain', 'Precipitation', (q) => (q.rainMax ?? 0) / 40),
        row('speed', 'Speed', (_q, i) => speed[i] / 60),
        row('lat', 'Latitude', (q) => (q.lat - 26) / 12),
      ];
    case 'rain':
    case 'storm':
      return [
        row('peak', 'Peak', (q) => (q.peak ?? 0) / (kind === 'rain' ? 300 : 80)),
        row('area', 'Area', (q) => Math.sqrt((q.area ?? 0) / (kind === 'rain' ? 6e5 : 6e4))),
        row('speed', 'Speed', (_q, i) => speed[i] / 40),
        row('land', 'Over land', (q) => q.landFrac ?? 0),
      ];
    case 'heat':
    case 'cold':
      return [
        row('peak', kind === 'heat' ? 'Peak max' : 'Lowest min', (q) => (kind === 'heat' ? ((q.peak ?? 40) - 38) / 10 : (10 - (q.peak ?? 10)) / 14)),
        row('dep', 'Departure', (q) => Math.abs(q.mean ?? 0) / 9),
        row('area', 'Area', (q) => Math.sqrt((q.area ?? 0) / 8e5)),
        row('severe', 'Severe share', (q) => q.severeFrac ?? 0),
      ];
  }
}

/** Summary genome over the given points (the whole life, or the life so far). */
export function genomeOf(kind: EventKind, p: TrackPoint[]): number[] {
  if (p.length === 0) return GENOME_LABELS[kind].map(() => 0);
  const first = p[0];
  const last = p[p.length - 1];
  const duration = last.t - first.t;
  let path = 0;
  for (let i = 1; i < p.length; i++) path += distKm(p[i - 1].lon, p[i - 1].lat, p[i].lon, p[i].lat);
  const disp = distKm(first.lon, first.lat, last.lon, last.lat);
  const meanSpeed = duration > 0 ? path / duration : 0;
  const straight = path > 0 ? disp / path : 1;
  switch (kind) {
    case 'cyclone': {
      let peak = 0;
      let peakT = first.t;
      let gain = 0;
      let size = 0;
      let rain = 0;
      for (const q of p) {
        if ((q.vmax ?? 0) > peak) {
          peak = q.vmax ?? 0;
          peakT = q.t;
        }
        size = Math.max(size, q.roci ?? 0);
        rain = Math.max(rain, q.rainMax ?? 0);
        const b = p.find((r) => r.t === q.t + 24);
        if (b) gain = Math.max(gain, (b.vmax ?? 0) - (q.vmax ?? 0));
      }
      const { heading } = motionOf(p);
      let turnRight = 0;
      for (let i = 1; i < heading.length; i++) turnRight += headingDelta(heading[i - 1], heading[i]);
      let landfall = 0;
      for (let i = 1; i < p.length; i++) {
        if (!p[i - 1].overLand && p[i].overLand) {
          landfall = Math.max(p[i - 1].vmax ?? 0, p[i].vmax ?? 0);
          break;
        }
      }
      return [
        clamp01((first.lat - 4) / 20),
        clamp01((first.lon - 55) / 45),
        clamp01(peak / 130),
        clamp01(gain / 60),
        clamp01((peakT - first.t) / 150),
        clamp01(duration / 240),
        clamp01(meanSpeed / 30),
        clamp01(straight),
        clamp01((turnRight + 90) / 270),
        clamp01(size / 700),
        clamp01(rain / 120),
        clamp01(landfall / 130),
      ];
    }
    case 'wd': {
      const amp = Math.max(...p.map((q) => q.amp ?? 0));
      const rain = Math.max(...p.map((q) => q.rainMax ?? 0));
      const lats = p.map((q) => q.lat);
      return [
        clamp01((first.lat - 26) / 12),
        clamp01(amp / 150),
        clamp01(meanSpeed / 60),
        clamp01(duration / 168),
        clamp01(rain / 40),
        clamp01((Math.max(...lats) - Math.min(...lats)) / 8),
      ];
    }
    case 'rain':
    case 'storm': {
      const peak = Math.max(...p.map((q) => q.peak ?? 0));
      const area = Math.max(...p.map((q) => q.area ?? 0));
      const mean = p.reduce((s, q) => s + (q.mean ?? q.peak ?? 0), 0) / p.length;
      const land = p.reduce((s, q) => s + (q.landFrac ?? 0), 0) / p.length;
      return kind === 'rain'
        ? [clamp01(peak / 300), clamp01(Math.sqrt(area / 6e5)), clamp01(mean / 150), clamp01(duration / 120), clamp01(meanSpeed / 40), clamp01(land)]
        : [clamp01(peak / 80), clamp01(Math.sqrt(area / 6e4)), clamp01(duration / 24), clamp01(meanSpeed / 40), clamp01(land), clamp01((first.lat - 5) / 30)];
    }
    case 'heat':
    case 'cold': {
      const peak = kind === 'heat' ? Math.max(...p.map((q) => q.peak ?? 0)) : Math.min(...p.map((q) => q.peak ?? 0));
      const dep = p.reduce((s, q) => s + Math.abs(q.mean ?? 0), 0) / p.length;
      const area = Math.max(...p.map((q) => q.area ?? 0));
      const severe = Math.max(...p.map((q) => q.severeFrac ?? 0));
      return [
        clamp01(kind === 'heat' ? (peak - 38) / 10 : (10 - peak) / 14),
        clamp01(dep / 9),
        clamp01(Math.sqrt(area / 8e5)),
        clamp01(severe),
        clamp01(duration / 192),
        clamp01((first.lat - 8) / 26),
      ];
    }
  }
}

function codeFor(kind: EventKind, p: TrackPoint[], genome: number[]): string[] {
  const first = p[0];
  if (kind === 'cyclone') {
    const origin = first.overLand ? 'L' : first.lon >= 78.3 ? 'B' : 'A';
    const band = Math.max(0, Math.min(4, Math.floor(first.lat / 5)));
    const peakCat = CYCLONE_SCALE[Math.max(...p.map((q) => catIndex(q.cat)))].code;
    const straight = genome[7];
    const turn = genome[8] * 270 - 90;
    const shape = turn > 75 ? 'R' : straight > 0.85 ? 'S' : straight < 0.5 ? 'E' : 'C';
    const rain = `r${1 + Math.min(3, Math.floor(genome[10] * 4))}`;
    return [`${origin}${band}`, peakCat, shape, rain];
  }
  if (kind === 'wd') return ['WD', genome[1] >= 0.57 ? 'Active' : genome[1] >= 0.33 ? 'Moderate' : 'Feeble', `lat${Math.round(26 + genome[0] * 12)}`];
  if (kind === 'heat' || kind === 'cold') return [kind === 'heat' ? 'HW' : 'CW', genome[3] >= 0.25 ? 'Severe' : 'Normal', `d${Math.round(genome[4] * 8)}`];
  return [kind === 'rain' ? 'RN' : 'TS', `p${Math.round(genome[0] * 10)}`, `a${Math.round(genome[1] * 10)}`];
}

export function dnaOf(kind: EventKind, p: TrackPoint[]): DNA {
  const values = genomeOf(kind, p);
  return {
    strip: stripFor(kind, p),
    genome: { values, labels: GENOME_LABELS[kind] },
    code: codeFor(kind, p, values),
  };
}

/** Weighted similarity in [0, 1] between two genomes of the same kind. */
export function similarity(kind: EventKind, a: number[], b: number[], mask?: boolean[]): number {
  const w = GENOME_WEIGHTS[kind];
  let s = 0;
  let ws = 0;
  for (let i = 0; i < a.length; i++) {
    if (mask && !mask[i]) continue;
    const d = a[i] - b[i];
    s += w[i] * d * d;
    ws += w[i];
  }
  const dist = Math.sqrt(s / Math.max(1e-9, ws));
  return Math.exp(-((dist / 0.16) ** 2));
}

/** Traits that are already known at a given age (used to mask the partial genome). */
export function knownAtAge(kind: EventKind): boolean[] {
  if (kind === 'cyclone') return [true, true, true, true, false, false, true, true, true, true, true, false];
  return GENOME_LABELS[kind].map(() => true);
}
