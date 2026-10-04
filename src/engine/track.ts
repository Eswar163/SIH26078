// Multi-object tracking of detected events across time steps.
//
// Vortices (cyclonic systems, western disturbances): each live track predicts
// its next position from its recent motion; detections are assigned by
// minimum total cost (Hungarian) with a distance gate. One missed step is
// bridged by interpolation.
//
// Areal events (rain, heat, cold, thunderstorms): assignment by cell overlap,
// falling back to centroid distance. One-to-many overlaps become splits,
// many-to-one overlaps become merges.
//
// Lineage between tracks is then inferred: merges and splits of vortices,
// regeneration after a land crossing, lows induced by western disturbances,
// and rain shields that belong to a cyclone.

import { bearingDeg, distKm } from './geo';
import { assign } from './hungarian';
import type { Detection, EventKind } from './detect';
import { catIndex } from './imd';

export type RelationType = 'split' | 'merge' | 'regenerated' | 'induced' | 'rainband';

export interface Relation {
  from: string;
  to: string;
  type: RelationType;
  t: number;
}

export interface TrackPoint extends Omit<Detection, 'cells' | 'kind'> {
  interpolated?: boolean;
}

export interface RawTrack {
  id: string;
  kind: EventKind;
  points: TrackPoint[];
  /** Cells of the last detection (areal kinds), used for overlap. Not kept after tracking. */
  lastCells?: Int32Array;
  endReason?: 'dissipated' | 'merged' | 'window';
}

const PREFIX: Record<EventKind, string> = { cyclone: 'c', wd: 'w', rain: 'r', heat: 'h', cold: 'k', storm: 's' };

function toPoint(d: Detection): TrackPoint {
  const { cells: _cells, kind: _kind, ...rest } = d;
  void _cells;
  void _kind;
  return rest;
}

function lerpPoint(a: TrackPoint, b: TrackPoint, f: number, t: number): TrackPoint {
  const mix = (x?: number, y?: number) => (x === undefined || y === undefined ? x ?? y : x + (y - x) * f);
  return {
    ...a,
    t,
    lon: a.lon + (b.lon - a.lon) * f,
    lat: a.lat + (b.lat - a.lat) * f,
    vmax: mix(a.vmax, b.vmax),
    pmin: mix(a.pmin, b.pmin),
    depth: mix(a.depth, b.depth),
    roci: mix(a.roci, b.roci),
    r34: mix(a.r34, b.r34),
    rmw: mix(a.rmw, b.rmw),
    amp: mix(a.amp, b.amp),
    area: mix(a.area, b.area),
    peak: mix(a.peak, b.peak),
    rainMax: mix(a.rainMax, b.rainMax),
    interpolated: true,
    rings: undefined,
  };
}

interface VortexOpts {
  gate: number;
  intensityWeight: number;
}

const VORTEX: Record<'cyclone' | 'wd', VortexOpts> = {
  cyclone: { gate: 380, intensityWeight: 0.12 },
  wd: { gate: 750, intensityWeight: 0 },
};

export function trackVortices(kind: 'cyclone' | 'wd', steps: Detection[][], times: number[], idStart = 1): RawTrack[] {
  const opts = VORTEX[kind];
  const tracks: RawTrack[] = [];
  interface Live {
    tr: RawTrack;
    last: number;
    vel: [number, number];
  }
  let live: Live[] = [];
  let next = idStart;
  for (let s = 0; s < steps.length; s++) {
    const dets = steps[s];
    const cands = live.filter((l) => s - l.last <= 2);
    const cost = cands.map((l) => {
      const lastP = l.tr.points[l.tr.points.length - 1];
      const gap = s - l.last;
      const pl = lastP.lon + l.vel[0] * gap;
      const pa = lastP.lat + l.vel[1] * gap;
      const gate = opts.gate * (1 + 0.5 * (gap - 1));
      return dets.map((d) => {
        const dist = distKm(pl, pa, d.lon, d.lat);
        if (dist > gate) return 1e6;
        const di = opts.intensityWeight ? Math.abs(catIndex(lastP.cat) - catIndex(d.cat)) : 0;
        return dist / gate + opts.intensityWeight * Math.min(3, di);
      });
    });
    const pick = cands.length && dets.length ? assign(cost, 1.0) : cands.map(() => -1);
    const taken = new Set<number>();
    cands.forEach((l, i) => {
      const j = pick[i];
      if (j < 0) return;
      taken.add(j);
      const d = dets[j];
      const lastP = l.tr.points[l.tr.points.length - 1];
      const gap = s - l.last;
      for (let g = 1; g < gap; g++) l.tr.points.push(lerpPoint(lastP, toPoint(d), g / gap, times[l.last + g]));
      const vl = (d.lon - lastP.lon) / gap;
      const va = (d.lat - lastP.lat) / gap;
      l.vel = l.tr.points.length > 1 ? [0.6 * vl + 0.4 * l.vel[0], 0.6 * va + 0.4 * l.vel[1]] : [vl, va];
      l.tr.points.push(toPoint(d));
      l.last = s;
    });
    dets.forEach((d, j) => {
      if (taken.has(j)) return;
      const tr: RawTrack = { id: `${PREFIX[kind]}${next++}`, kind, points: [toPoint(d)] };
      tracks.push(tr);
      live.push({ tr, last: s, vel: [0, 0] });
    });
    live = live.filter((l) => {
      if (s - l.last >= 2) {
        l.tr.endReason = 'dissipated';
        return false;
      }
      return true;
    });
  }
  for (const l of live) l.tr.endReason = l.last === steps.length - 1 ? 'window' : 'dissipated';
  return tracks;
}

export function trackAreal(kind: EventKind, steps: Detection[][], times: number[], relations: Relation[], idStart = 1): RawTrack[] {
  const tracks: RawTrack[] = [];
  interface Live {
    tr: RawTrack;
    last: number;
    cells: Set<number>;
  }
  let live: Live[] = [];
  let next = idStart;
  const gate = kind === 'storm' ? 250 : 420;
  for (let s = 0; s < steps.length; s++) {
    const dets = steps[s];
    const cands = live.filter((l) => s - l.last <= 2);
    const overlap = cands.map((l) =>
      dets.map((d) => {
        let o = 0;
        if (d.cells) for (const k of d.cells) if (l.cells.has(k)) o++;
        return o;
      }),
    );
    const cost = cands.map((l, i) =>
      dets.map((d, j) => {
        const o = overlap[i][j];
        const nA = l.cells.size;
        const nB = d.cells?.length ?? 1;
        if (o > 0) return 1 - (0.85 * o) / Math.min(nA, nB);
        const lp = l.tr.points[l.tr.points.length - 1];
        const dist = distKm(lp.lon, lp.lat, d.lon, d.lat);
        return dist < gate ? 0.86 + (0.13 * dist) / gate : 1e6;
      }),
    );
    const pick = cands.length && dets.length ? assign(cost, 0.995) : cands.map(() => -1);
    const takenBy = new Map<number, Live>();
    cands.forEach((l, i) => {
      const j = pick[i];
      if (j < 0) return;
      const d = dets[j];
      const lastP = l.tr.points[l.tr.points.length - 1];
      const gap = s - l.last;
      for (let g = 1; g < gap; g++) l.tr.points.push(lerpPoint(lastP, toPoint(d), g / gap, times[l.last + g]));
      l.tr.points.push(toPoint(d));
      l.last = s;
      l.cells = new Set(d.cells ?? []);
      takenBy.set(j, l);
    });
    // Merges: a live track that was not continued but overlaps a continued detection.
    cands.forEach((l, i) => {
      if (pick[i] >= 0) return;
      let best = -1;
      let bestO = 0;
      dets.forEach((_, j) => {
        if (overlap[i][j] > bestO && takenBy.has(j)) {
          bestO = overlap[i][j];
          best = j;
        }
      });
      if (best >= 0 && bestO >= 0.3 * l.cells.size) {
        const into = takenBy.get(best)!;
        relations.push({ from: l.tr.id, to: into.tr.id, type: 'merge', t: times[s] });
        l.tr.endReason = 'merged';
        l.last = -99;
      }
    });
    dets.forEach((d, j) => {
      if (takenBy.has(j)) return;
      const tr: RawTrack = { id: `${PREFIX[kind]}${next++}`, kind, points: [toPoint(d)] };
      tracks.push(tr);
      // Split: the new piece overlaps a track that also continued this step.
      let parent: Live | null = null;
      let bestO = 0;
      cands.forEach((l, i) => {
        if (overlap[i][j] > bestO) {
          bestO = overlap[i][j];
          parent = l;
        }
      });
      const nB = d.cells?.length ?? 1;
      if (parent && bestO >= 0.3 * nB) relations.push({ from: (parent as Live).tr.id, to: tr.id, type: 'split', t: times[s] });
      const nl: Live = { tr, last: s, cells: new Set(d.cells ?? []) };
      live.push(nl);
      takenBy.set(j, nl);
    });
    live = live.filter((l) => {
      if (s - l.last >= 2) {
        if (!l.tr.endReason) l.tr.endReason = 'dissipated';
        return false;
      }
      return true;
    });
  }
  for (const l of live) l.tr.endReason = l.last === steps.length - 1 ? 'window' : l.tr.endReason ?? 'dissipated';
  return tracks;
}

// ---------------------------------------------------------------------------
// Lineage between vortex tracks and across kinds

const at = (tr: RawTrack, t: number) => tr.points.find((p) => p.t === t);

export function inferLineage(tracks: RawTrack[], relations: Relation[], lastTime: number): RawTrack[] {
  const cyc = tracks.filter((t) => t.kind === 'cyclone');
  const wds = tracks.filter((t) => t.kind === 'wd');

  // Regeneration by basin crossing: Bay -> land -> Arabian Sea (or reverse) and back to >= D.
  const extra: RawTrack[] = [];
  for (const tr of cyc) {
    const p = tr.points;
    const basinOf = (q: TrackPoint) => (q.overLand ? 'L' : q.lon >= 78.3 ? 'B' : 'A');
    let k0 = -1;
    for (let k = 1; k < p.length; k++) {
      const b0 = basinOf(p[0]);
      if (b0 === 'L') break;
      const b = basinOf(p[k]);
      if (b !== 'L' && b !== b0) {
        const crossedLand = p.slice(1, k).some((q) => q.overLand);
        const later = p.slice(k);
        if (crossedLand && later.some((q) => (q.vmax ?? 0) >= 17)) k0 = k;
        break;
      }
    }
    if (k0 > 0) {
      const child: RawTrack = { id: `${tr.id}r`, kind: 'cyclone', points: p.slice(k0), endReason: tr.endReason };
      tr.points = p.slice(0, k0);
      tr.endReason = 'dissipated';
      extra.push(child);
      relations.push({ from: tr.id, to: child.id, type: 'regenerated', t: child.points[0].t });
    }
  }
  cyc.push(...extra);
  tracks.push(...extra);

  for (const tr of cyc) {
    const first = tr.points[0];
    const last = tr.points[tr.points.length - 1];
    // Merge: the track ends next to a stronger live system.
    const regenParent = relations.some((r) => r.from === tr.id && r.type === 'regenerated');
    if (tr.endReason === 'dissipated' && last.t < lastTime && !regenParent) {
      for (const o of cyc) {
        if (o === tr) continue;
        const q = at(o, last.t + 6) ?? at(o, last.t);
        if (!q) continue;
        if (distKm(last.lon, last.lat, q.lon, q.lat) < 420 && (q.vmax ?? 0) >= (last.vmax ?? 0) * 0.9) {
          relations.push({ from: tr.id, to: o.id, type: 'merge', t: last.t + 6 });
          tr.endReason = 'merged';
          break;
        }
      }
    }
    if (relations.some((r) => r.to === tr.id)) continue;
    // Regeneration: a new system over the sea close to where a land-crossing track faded.
    let linked = false;
    for (const o of cyc) {
      if (o === tr) continue;
      const ol = o.points[o.points.length - 1];
      if (o.endReason !== 'dissipated' || !ol.overLand || first.overLand) continue;
      const dt = first.t - ol.t;
      if (dt <= 0 || dt > 48) continue;
      if (distKm(ol.lon, ol.lat, first.lon, first.lat) < 650) {
        relations.push({ from: o.id, to: tr.id, type: 'regenerated', t: first.t });
        linked = true;
        break;
      }
    }
    if (linked) continue;
    // Split: born inside the circulation of an established system.
    for (const o of cyc) {
      if (o === tr || o.points[0].t > first.t - 12) continue;
      const q = at(o, first.t);
      if (!q) continue;
      const reach = Math.max(380, Math.min(520, (q.roci ?? 300) + 120));
      if (distKm(q.lon, q.lat, first.lon, first.lat) < reach) {
        relations.push({ from: o.id, to: tr.id, type: 'split', t: first.t });
        linked = true;
        break;
      }
    }
    if (linked) continue;
    // Induced by a western disturbance: a low forming south of an active trough.
    if (first.lat > 20 && first.lat < 32) {
      for (const w of wds) {
        const q = at(w, first.t) ?? at(w, first.t - 6);
        if (!q) continue;
        const d = distKm(q.lon, q.lat, first.lon, first.lat);
        const b = bearingDeg(q.lon, q.lat, first.lon, first.lat);
        if (d < 1300 && b > 90 && b < 240) {
          relations.push({ from: w.id, to: tr.id, type: 'induced', t: first.t });
          break;
        }
      }
    }
  }

  // Rain shields that belong to a cyclone or a western disturbance.
  for (const tr of tracks.filter((t) => t.kind === 'rain')) {
    if (relations.some((r) => r.to === tr.id)) continue;
    const first = tr.points[0];
    let best: { id: string; d: number } | null = null;
    for (const o of [...cyc, ...wds]) {
      const q = at(o, first.t);
      if (!q) continue;
      const d = distKm(q.lon, q.lat, first.lon, first.lat);
      const reach = o.kind === 'cyclone' ? 550 : 900;
      if (d < reach && (!best || d < best.d)) best = { id: o.id, d };
    }
    if (best) relations.push({ from: best.id, to: tr.id, type: 'rainband', t: first.t });
  }

  // Cold waves that follow a western disturbance.
  for (const tr of tracks.filter((t) => t.kind === 'cold')) {
    const first = tr.points[0];
    for (const w of wds) {
      const wl = w.points[w.points.length - 1];
      const passed = w.points.find((p) => p.lon >= first.lon - 2);
      if (!passed) continue;
      const dt = first.t - passed.t;
      if (dt >= 0 && dt <= 96 && Math.abs(passed.lat - first.lat) < 10) {
        relations.push({ from: w.id, to: tr.id, type: 'induced', t: first.t });
        break;
      }
      void wl;
    }
  }
  return tracks;
}

/** Drop tracks that are too short or too weak to be meaningful. */
export function pruneTracks(tracks: RawTrack[], relations: Relation[]): RawTrack[] {
  const keep = tracks.filter((tr) => {
    const n = tr.points.length;
    if (tr.kind === 'cyclone') {
      const maxCat = Math.max(...tr.points.map((p) => catIndex(p.cat)));
      return n >= 3 || maxCat >= 2;
    }
    if (tr.kind === 'storm') return n >= 2 || tr.points.some((p) => p.cat === 'STS');
    if (tr.kind === 'rain') return n >= 2 && (n >= 3 || tr.points.some((p) => (p.peak ?? 0) >= 115.6));
    if (tr.kind === 'wd') return n >= 3;
    return n >= 2;
  });
  const ids = new Set(keep.map((t) => t.id));
  for (let i = relations.length - 1; i >= 0; i--) {
    if (!ids.has(relations[i].from) || !ids.has(relations[i].to)) relations.splice(i, 1);
  }
  return keep;
}
