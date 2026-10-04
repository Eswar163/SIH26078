// Analog intelligence over Event Memory.
//
// - findAnalogs: age-aligned DNA matching (compare the life so far of a live
//   event with the same age of every remembered event), or whole-life matching.
// - analogGuidance: what the closest relatives did next, weighted by similarity.
// - novelty: how unusual an event is relative to everything remembered.
// - embed: a 2-D map of DNA space (principal components) for the Memory view.

import type { ArchiveEvent } from './archive';
import { partialGenome } from './archive';
import type { EventKind } from './detect';
import { genomeOf, knownAtAge, similarity } from './dna';
import type { EventTrack } from './events';
import { catIndex, CYCLONE_SCALE } from './imd';

export interface Analog {
  event: ArchiveEvent;
  similarity: number;
  /** Age (h) at which the comparison was made, or null for whole-life matching. */
  age: number | null;
}

export function liveAge(ev: EventTrack): number | null {
  if (ev.t0 > 0) return null;
  return Math.max(0, Math.min(0, ev.t1) - ev.t0);
}

export function findAnalogs(ev: EventTrack, archive: ArchiveEvent[], k = 8, mode: 'history' | 'lifecycle' = 'history'): Analog[] {
  const pool = archive.filter((a) => a.kind === ev.kind);
  const age = mode === 'history' ? liveAge(ev) : null;
  let scored: Analog[];
  if (age !== null && age >= 6) {
    const mine = genomeOf(ev.kind, ev.points.filter((p) => p.t <= 0));
    const mask = knownAtAge(ev.kind);
    scored = pool
      .filter((a) => a.duration >= age)
      .map((a) => ({ event: a, similarity: similarity(ev.kind, mine, partialGenome(a, age), mask), age }));
  } else {
    scored = pool.map((a) => ({ event: a, similarity: similarity(ev.kind, ev.dna.genome.values, a.dna.genome.values), age: null }));
  }
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, k);
}

export interface AnalogGuidance {
  n: number;
  weightSum: number;
  peakCat: { code: string; p: number }[];
  medianPeakCat: string;
  landfallP: number;
  regions: { region: string; p: number }[];
  medianDuration: number;
  riP: number;
  agreement: 'agree' | 'mixed' | 'disagree' | 'n/a';
  note: string;
}

export function analogGuidance(ev: EventTrack, analogs: Analog[]): AnalogGuidance {
  const w = analogs.map((a) => a.similarity);
  const ws = w.reduce((s, x) => s + x, 0) || 1;
  const cats = new Map<string, number>();
  const regions = new Map<string, number>();
  let lf = 0;
  let ri = 0;
  const durations: number[] = [];
  analogs.forEach((a, i) => {
    const wi = w[i] / ws;
    cats.set(a.event.maxCat, (cats.get(a.event.maxCat) ?? 0) + wi);
    if (a.event.landfall) {
      lf += wi;
      regions.set(a.event.landfall.region, (regions.get(a.event.landfall.region) ?? 0) + wi);
    }
    if (hasRI(a.event)) ri += wi;
    durations.push(a.event.duration);
  });
  const peakCat = [...cats.entries()].map(([code, p]) => ({ code, p })).sort((a, b) => catIndex(b.code) - catIndex(a.code));
  let acc = 0;
  let median = peakCat[0]?.code ?? '-';
  for (const c of [...peakCat].sort((a, b) => catIndex(a.code) - catIndex(b.code))) {
    acc += c.p;
    if (acc >= 0.5) {
      median = c.code;
      break;
    }
  }
  durations.sort((a, b) => a - b);
  let agreement: AnalogGuidance['agreement'] = 'n/a';
  let note = '';
  if (ev.kind === 'cyclone' && analogs.length) {
    const nwp = catIndex(ev.maxCat);
    const ana = catIndex(median);
    const diff = Math.abs(nwp - ana);
    agreement = diff === 0 ? 'agree' : diff === 1 ? 'mixed' : 'disagree';
    const nwpName = CYCLONE_SCALE[nwp].code;
    note =
      agreement === 'agree'
        ? `Relatives peaked at ${median}, matching the model's ${nwpName}.`
        : nwp > ana
          ? `The model peaks this system at ${nwpName}, stronger than most relatives (${median}).`
          : `Relatives typically reached ${median}; the model is more conservative at ${nwpName}.`;
  }
  return {
    n: analogs.length,
    weightSum: ws,
    peakCat,
    medianPeakCat: median,
    landfallP: lf,
    regions: [...regions.entries()].map(([region, p]) => ({ region, p })).sort((a, b) => b.p - a.p),
    medianDuration: durations.length ? durations[Math.floor(durations.length / 2)] : 0,
    riP: ri,
    agreement,
    note,
  };
}

function hasRI(a: ArchiveEvent): boolean {
  if (a.kind !== 'cyclone') return false;
  const p = a.points;
  for (let i = 0; i < p.length; i++) {
    const j = p.findIndex((q) => q.t === p[i].t + 24);
    if (j > 0 && (p[j].vmax ?? 0) - (p[i].vmax ?? 0) >= 30) return true;
  }
  return false;
}

/** 0 = very familiar, 1 = nothing like it in memory. */
export function novelty(ev: EventTrack, archive: ArchiveEvent[]): number {
  const top = findAnalogs(ev, archive, 3, 'lifecycle');
  if (!top.length) return 1;
  const mean = top.reduce((s, a) => s + a.similarity, 0) / top.length;
  return Math.max(0, Math.min(1, 1 - mean));
}

// ---------------------------------------------------------------------------
// Principal components of DNA space

export interface Embedding {
  axes: { x: string; y: string };
  points: { id: string; x: number; y: number }[];
  project: (genome: number[]) => [number, number];
}

export function embed(kind: EventKind, items: { id: string; genome: number[] }[], labels: string[]): Embedding {
  const n = items.length;
  const dim = items[0]?.genome.length ?? 0;
  const mean = new Array(dim).fill(0);
  for (const it of items) for (let d = 0; d < dim; d++) mean[d] += it.genome[d] / Math.max(1, n);
  const cov = Array.from({ length: dim }, () => new Array(dim).fill(0));
  for (const it of items) {
    for (let a = 0; a < dim; a++) {
      const da = it.genome[a] - mean[a];
      for (let b = a; b < dim; b++) cov[a][b] += (da * (it.genome[b] - mean[b])) / Math.max(1, n - 1);
    }
  }
  for (let a = 0; a < dim; a++) for (let b = 0; b < a; b++) cov[a][b] = cov[b][a];
  const pc1 = powerIteration(cov, dim, null);
  const pc2 = powerIteration(cov, dim, pc1);
  const project = (g: number[]): [number, number] => {
    let x = 0;
    let y = 0;
    for (let d = 0; d < dim; d++) {
      x += (g[d] - mean[d]) * pc1[d];
      y += (g[d] - mean[d]) * pc2[d];
    }
    return [x, y];
  };
  const axisName = (v: number[]) => {
    const order = v.map((x, i) => [Math.abs(x), i] as [number, number]).sort((a, b) => b[0] - a[0]);
    return labels[order[0][1]];
  };
  void kind;
  return {
    axes: { x: axisName(pc1), y: axisName(pc2) },
    points: items.map((it) => {
      const [x, y] = project(it.genome);
      return { id: it.id, x, y };
    }),
    project,
  };
}

function powerIteration(m: number[][], dim: number, orth: number[] | null): number[] {
  let v = Array.from({ length: dim }, (_, i) => 1 / Math.sqrt(dim) + (i % 2 ? 0.01 : -0.01));
  for (let it = 0; it < 80; it++) {
    const w = new Array(dim).fill(0);
    for (let a = 0; a < dim; a++) for (let b = 0; b < dim; b++) w[a] += m[a][b] * v[b];
    if (orth) {
      const dot = w.reduce((s, x, i) => s + x * orth[i], 0);
      for (let i = 0; i < dim; i++) w[i] -= dot * orth[i];
    }
    const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0)) || 1;
    v = w.map((x) => x / norm);
  }
  return v;
}
