// Turns raw tracks into named, staged, fingerprinted events.

import type { EventKind } from './detect';
import { dnaOf, type DNA } from './dna';
import type { GridSpec } from './grid';
import { sample } from './grid';
import { catIndex, CYCLONE_SCALE } from './imd';
import { landfallOf, milestonesOf, motionOf, stagesOf, type Landfall, type Milestone, type Stage } from './lifecycle';
import { basinOf, type Basin } from './places';
import type { SeasonId } from './climate';
import type { RawTrack, Relation, TrackPoint } from './track';

export interface EventTrack {
  id: string;
  kind: EventKind;
  label: string;
  name?: string;
  pendingName?: string;
  basin?: Basin;
  points: TrackPoint[];
  stages: Stage[];
  speed: number[];
  heading: number[];
  milestones: Milestone[];
  landfall: Landfall | null;
  dna: DNA;
  t0: number;
  t1: number;
  peakIndex: number;
  maxCat: string;
  endReason: 'dissipated' | 'merged' | 'window';
  env?: { sst: number[]; shear: number[]; rh: number[] };
  truthId?: number;
}

// Storm names for the synthetic runs are fictional: Hindustani ragas, so they
// can never be confused with a real cyclone from the WMO/ESCAP list.
export const STORM_NAMES = [
  'Malhar', 'Yaman', 'Bihag', 'Kedar', 'Sarang', 'Lalit', 'Marwa', 'Kafi', 'Desh', 'Todi',
  'Puriya', 'Bhairav', 'Basant', 'Kalyani', 'Sohini', 'Jaunpuri', 'Darbari', 'Bageshri', 'Asavari', 'Hindol',
];

const KIND_LABEL: Record<EventKind, string> = {
  cyclone: 'Low',
  wd: 'WD',
  rain: 'Heavy rain',
  heat: 'Heat wave',
  cold: 'Cold wave',
  storm: 'Thunderstorm',
};

const BASIN_START: Record<SeasonId, Record<Basin, number>> = {
  postmonsoon: { BOB: 7, ARB: 3, LAND: 3 },
  monsoon: { BOB: 3, ARB: 1, LAND: 2 },
  premonsoon: { BOB: 1, ARB: 1, LAND: 1 },
  winter: { BOB: 1, ARB: 1, LAND: 1 },
};

export interface EnrichContext {
  season: SeasonId;
  seed: number;
  grid: GridSpec;
  sst?: Float32Array;
  shear?: Float32Array;
  rh?: Float32Array;
  /** Index into STORM_NAMES of the next name on the list. */
  nameIndex?: number;
}

export function enrich(raw: RawTrack[], relations: Relation[], ctx: EnrichContext): EventTrack[] {
  const events: EventTrack[] = raw.map((tr) => {
    const motion = motionOf(tr.points);
    const peakIndex = tr.points.reduce((best, q, i, arr) => (scoreOf(tr.kind, q) > scoreOf(tr.kind, arr[best]) ? i : best), 0);
    const maxCat = tr.kind === 'cyclone' ? CYCLONE_SCALE[Math.max(...tr.points.map((q) => catIndex(q.cat)))].code : tr.points[peakIndex].cat;
    const ev: EventTrack = {
      id: tr.id,
      kind: tr.kind,
      label: '',
      points: tr.points,
      stages: stagesOf(tr),
      speed: motion.speed,
      heading: motion.heading,
      milestones: milestonesOf(tr, relations, motion),
      landfall: landfallOf(tr),
      dna: dnaOf(tr.kind, tr.points),
      t0: tr.points[0].t,
      t1: tr.points[tr.points.length - 1].t,
      peakIndex,
      maxCat,
      endReason: tr.endReason ?? 'window',
    };
    if (tr.kind === 'cyclone') {
      ev.basin = basinOf(tr.points[0].lon, tr.points[0].lat, tr.points[0].overLand);
      if (ctx.sst && ctx.shear && ctx.rh) {
        ev.env = {
          sst: tr.points.map((q) => round1(sample(ctx.grid, ctx.sst!, q.lon, q.lat))),
          shear: tr.points.map((q) => round1(sample(ctx.grid, ctx.shear!, q.lon, q.lat))),
          rh: tr.points.map((q) => Math.round(sample(ctx.grid, ctx.rh!, q.lon, q.lat) * 100) / 100),
        };
      }
    }
    return ev;
  });

  // Labels: depressions get IMD-style basin numbers, weaker lows a running number.
  const counters = { ...BASIN_START[ctx.season] };
  let lows = 1;
  const byKind = new Map<EventKind, number>();
  const ordered = [...events].sort((a, b) => a.t0 - b.t0 || a.id.localeCompare(b.id));
  for (const ev of ordered) {
    if (ev.kind === 'cyclone') {
      if (catIndex(ev.maxCat) >= 2 && ev.basin) {
        ev.label = `${ev.basin} ${String(counters[ev.basin]++).padStart(2, '0')}`;
      } else {
        ev.label = `Low ${lows++}`;
      }
    } else {
      const n = (byKind.get(ev.kind) ?? 0) + 1;
      byKind.set(ev.kind, n);
      ev.label = `${KIND_LABEL[ev.kind]} ${n}`;
    }
  }

  // Names: in order of first reaching cyclonic-storm strength.
  let nameIdx = ctx.nameIndex ?? ctx.seed % STORM_NAMES.length;
  const firstCs = (ev: EventTrack) => ev.points.find((q) => catIndex(q.cat) >= 4)?.t ?? Infinity;
  const storms = events.filter((e) => e.kind === 'cyclone' && Number.isFinite(firstCs(e))).sort((a, b) => firstCs(a) - firstCs(b));
  for (const ev of storms) {
    const name = STORM_NAMES[nameIdx % STORM_NAMES.length];
    nameIdx++;
    if (firstCs(ev) <= 0) ev.name = name;
    else ev.pendingName = name;
  }
  return events;
}

function scoreOf(kind: EventKind, q: TrackPoint): number {
  switch (kind) {
    case 'cyclone':
      return q.vmax ?? 0;
    case 'wd':
      return q.amp ?? 0;
    case 'heat':
    case 'cold':
      return Math.abs(q.mean ?? 0) * Math.sqrt(q.area ?? 0);
    default:
      return (q.peak ?? 0) * Math.sqrt(q.area ?? 1);
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function displayName(ev: Pick<EventTrack, 'label' | 'name'>): string {
  return ev.name ? `${ev.name}` : ev.label;
}

export function pointAt(ev: EventTrack, t: number): TrackPoint | undefined {
  return ev.points.find((p) => p.t === t);
}

export function indexAt(ev: EventTrack, t: number): number {
  return ev.points.findIndex((p) => p.t === t);
}
