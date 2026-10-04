// Event Memory: a synthetic best-track archive. Thirty-five seasons of each
// type are simulated with the same atmosphere model; every system that matters
// becomes an archived event with its track, lifecycle, DNA and lineage.
// The archive is the training data for the analog search and the
// rapid-intensification model, and the reference for "novelty".

import { SEASONS, envAt, type SeasonId } from './climate';
import type { EventKind } from './detect';
import { dnaOf, genomeOf, type DNA } from './dna';
import { STORM_NAMES } from './events';
import { catIndex, cycloneCat, CYCLONE_SCALE } from './imd';
import { landfallOf, milestonesOf, motionOf, stagesOf, type Landfall } from './lifecycle';
import { basinOf } from './places';
import { mixSeed, makeRng } from './rng';
import { representativeDate } from './climate';
import { inferLineage, type RawTrack, type Relation, type TrackPoint } from './track';
import { makeWorld, pressureDeficit, type SysHistory } from './world';
import { landInfo } from './land';
import { makeGrid, sample } from './grid';

export interface ArchiveEvent {
  id: string;
  year: number;
  season: SeasonId;
  kind: EventKind;
  label: string;
  name?: string;
  /** Epoch ms of t = 0 for this episode; point times are hours from it. */
  epoch: number;
  points: TrackPoint[];
  dna: DNA;
  landfall: Landfall | null;
  maxCat: string;
  peak: number;
  duration: number;
  env?: { sst: number[]; shear: number[]; rh: number[] };
}

export interface Archive {
  events: ArchiveEvent[];
  links: Relation[];
  years: [number, number];
}

const SEASON_ORDER: SeasonId[] = ['winter', 'premonsoon', 'monsoon', 'postmonsoon'];
const LAND_G = makeGrid(0.25);

function historyToPoints(h: SysHistory, season: SeasonId, rng: ReturnType<typeof makeRng>): TrackPoint[] {
  const land = landInfo(LAND_G).frac;
  const pts: TrackPoint[] = [];
  const isVortex = h.kind === 'tc' || h.kind === 'mlow';
  for (let k = (6 - (((h.t0 % 6) + 6) % 6)) % 6; k < h.lon.length; k += 6) {
    const t = h.t0 + k;
    const lon = h.lon[k] + rng.normal(0, 0.05);
    const lat = h.lat[k] + rng.normal(0, 0.05);
    const v = h.v[k];
    const overLand = sample(LAND_G, land, lon, lat) > 0.5;
    if (isVortex) {
      const vmax = Math.max(0, v + rng.normal(0, 1.5));
      const depth = pressureDeficit(h.kind, vmax);
      pts.push({
        t,
        lon,
        lat,
        cat: cycloneCat(vmax, depth > 3 ? 2 : 1),
        score: 1,
        overLand,
        vmax,
        pmin: 1008 - depth,
        depth,
        roci: h.roci[k],
        rmw: h.rmax[k],
        rainMax: (h.kind === 'tc' ? 12 + 0.9 * vmax : 10 + vmax) * h.rainEff,
      });
    } else if (h.kind === 'wd') {
      pts.push({ t, lon, lat, cat: v >= 85 ? 'Active' : v >= 50 ? 'Moderate' : 'Feeble', score: 1, overLand, amp: v, rainMax: (v / 100) * 14 });
    } else {
      const heat = h.kind === 'heat';
      const season0 = SEASONS[season];
      const normal = heat ? 33 + season0.tAmp : 12 - season0.tAmp;
      const area = Math.PI * (h.rmax[k] * 1.1) ** 2 * Math.min(1, Math.max(0, (v - 3.5) / 3));
      if (area <= 0) continue;
      pts.push({
        t,
        lon,
        lat,
        cat: heat ? (v >= 6 ? 'SHW' : 'HW') : v >= 6 ? 'SCW' : 'CW',
        score: 1,
        overLand: true,
        peak: heat ? normal + v * 1.1 : normal - v * 1.1,
        mean: heat ? v * 0.75 : -v * 0.75,
        area,
        severeFrac: Math.max(0, Math.min(1, (v - 5.5) / 3)),
        landFrac: 1,
      });
    }
  }
  return pts;
}

export function buildArchive(firstYear = 1991, lastYear = 2025): Archive {
  const events: ArchiveEvent[] = [];
  const links: Relation[] = [];
  let nameIdx = 0;
  for (let year = firstYear; year <= lastYear; year++) {
    const counters: Record<string, number> = { BOB: 1, ARB: 1, LAND: 1 };
    for (const season of SEASON_ORDER) {
      const seed = mixSeed(year, season, 'archive');
      const epoch = representativeDate(season, year);
      const world = makeWorld(season, seed, epoch);
      const rng = makeRng(seed, 'besttrack');
      const raw: RawTrack[] = [];
      const relations: Relation[] = [];
      const byId = new Map<number, string>();
      for (const h of world.truth) {
        if (h.kind === 'conv') continue;
        const pts = historyToPoints(h, season, rng);
        if (pts.length < 3) continue;
        const kind: EventKind = h.kind === 'tc' || h.kind === 'mlow' ? 'cyclone' : h.kind === 'wd' ? 'wd' : h.kind === 'heat' ? 'heat' : 'cold';
        if (kind === 'cyclone' && !pts.some((p) => (p.vmax ?? 0) >= 17)) continue;
        const id = `${year}-${season}-${h.id}`;
        byId.set(h.id, id);
        raw.push({ id, kind, points: pts, endReason: h.mergedInto ? 'merged' : 'dissipated' });
      }
      for (const h of world.truth) {
        const id = byId.get(h.id);
        if (!id) continue;
        if (h.parent && byId.has(h.parent.id)) relations.push({ from: byId.get(h.parent.id)!, to: id, type: h.parent.relation, t: h.t0 });
        if (h.mergedInto && byId.has(h.mergedInto.id)) relations.push({ from: id, to: byId.get(h.mergedInto.id)!, type: 'merge', t: h.mergedInto.t });
      }
      inferLineage(raw, relations, Infinity);
      // De-duplicate relations that the generator and the inference both produced.
      const seen = new Set<string>();
      for (const r of relations) {
        const key = `${r.from}>${r.to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push(r);
      }
      const ordered = raw.sort((a, b) => a.points[0].t - b.points[0].t);
      const kindCount = new Map<EventKind, number>();
      for (const tr of ordered) {
        if (tr.kind === 'rain' || tr.kind === 'storm') continue;
        const p = tr.points;
        let peak = 0;
        for (const q of p) peak = Math.max(peak, tr.kind === 'cyclone' ? q.vmax ?? 0 : tr.kind === 'wd' ? q.amp ?? 0 : Math.abs(q.mean ?? 0));
        let label: string;
        let name: string | undefined;
        let maxCat: string;
        let env: ArchiveEvent['env'];
        if (tr.kind === 'cyclone') {
          const basin = basinOf(p[0].lon, p[0].lat, p[0].overLand);
          label = `${basin} ${String(counters[basin]++).padStart(2, '0')}/${year}`;
          maxCat = CYCLONE_SCALE[Math.max(...p.map((q) => catIndex(q.cat)))].code;
          if (catIndex(maxCat) >= 4) name = STORM_NAMES[nameIdx++ % STORM_NAMES.length];
          env = { sst: [], shear: [], rh: [] };
          for (const q of p) {
            const e = envAt(SEASONS[season], q.lon, q.lat);
            env.sst.push(Math.round(e.sst * 10) / 10);
            env.shear.push(Math.round(e.shear * 10) / 10);
            env.rh.push(Math.round(e.rh * 100) / 100);
          }
        } else {
          const n = (kindCount.get(tr.kind) ?? 0) + 1;
          kindCount.set(tr.kind, n);
          const word = tr.kind === 'wd' ? 'WD' : tr.kind === 'heat' ? 'Heat wave' : 'Cold wave';
          label = `${word} ${n}/${year}`;
          maxCat = p.reduce((best, q) => (q.cat.startsWith('S') || q.cat === 'Active' ? q.cat : best), p[0].cat);
        }
        events.push({
          id: tr.id,
          year,
          season,
          kind: tr.kind,
          label,
          name,
          epoch,
          points: p,
          dna: dnaOf(tr.kind, p),
          landfall: landfallOf(tr),
          maxCat,
          peak,
          duration: p[p.length - 1].t - p[0].t,
          env,
        });
      }
    }
  }
  return { events, links, years: [firstYear, lastYear] };
}

/** Partial genomes at 6-hourly ages, cached per event for analog search. */
const partialCache = new WeakMap<ArchiveEvent, Map<number, number[]>>();

export function partialGenome(ev: ArchiveEvent, ageH: number): number[] {
  let m = partialCache.get(ev);
  if (!m) {
    m = new Map();
    partialCache.set(ev, m);
  }
  const key = Math.round(ageH / 6) * 6;
  const hit = m.get(key);
  if (hit) return hit;
  const t0 = ev.points[0].t;
  const g = genomeOf(ev.kind, ev.points.filter((p) => p.t - t0 <= key));
  m.set(key, g);
  return g;
}

/** Present an archived event with the same shape as a live one (for charts and dossiers). */
export function archiveToEvent(a: ArchiveEvent, links: Relation[]): import('./events').EventTrack {
  const raw: RawTrack = { id: a.id, kind: a.kind, points: a.points, endReason: 'dissipated' };
  const motion = motionOf(a.points);
  let peakIndex = 0;
  a.points.forEach((p, i) => {
    const v = a.kind === 'cyclone' ? p.vmax ?? 0 : a.kind === 'wd' ? p.amp ?? 0 : Math.abs(p.mean ?? 0);
    const b = a.kind === 'cyclone' ? a.points[peakIndex].vmax ?? 0 : a.kind === 'wd' ? a.points[peakIndex].amp ?? 0 : Math.abs(a.points[peakIndex].mean ?? 0);
    if (v > b) peakIndex = i;
  });
  return {
    id: a.id,
    kind: a.kind,
    label: a.label,
    name: a.name,
    points: a.points,
    stages: stagesOf(raw),
    speed: motion.speed,
    heading: motion.heading,
    milestones: milestonesOf(raw, links, motion),
    landfall: a.landfall,
    dna: a.dna,
    t0: a.points[0].t,
    t1: a.points[a.points.length - 1].t,
    peakIndex,
    maxCat: a.maxCat,
    endReason: 'dissipated',
    env: a.env,
  };
}
