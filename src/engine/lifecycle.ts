// Lifecycle staging and milestones for tracked events.

import { bearingDeg, distKm, headingDelta } from './geo';
import { catIndex, catName, CYCLONE_SCALE } from './imd';
import { isLandPoint } from './land';
import { coastPosition, relativeTo, referenceCities } from './places';
import type { EventKind } from './detect';
import type { RawTrack, Relation, TrackPoint } from './track';

export type Stage = 'genesis' | 'intensifying' | 'mature' | 'steady' | 'weakening' | 'dissipating';

export const STAGE_LABEL: Record<Stage, string> = {
  genesis: 'Genesis',
  intensifying: 'Intensifying',
  mature: 'Mature',
  steady: 'Steady',
  weakening: 'Weakening',
  dissipating: 'Dissipating',
};

export type MilestoneType =
  | 'genesis'
  | 'upgrade'
  | 'named'
  | 'peak'
  | 'ri'
  | 'landfall'
  | 'recurvature'
  | 'stall'
  | 'downgrade'
  | 'dissipation'
  | 'merge'
  | 'split'
  | 'regenerated'
  | 'induced';

export interface Milestone {
  t: number;
  type: MilestoneType;
  label: string;
  lon: number;
  lat: number;
}

export interface Motion {
  speed: number[]; // km/h
  heading: number[]; // degrees, direction of motion
}

export function intensityOf(kind: EventKind, p: TrackPoint): number {
  switch (kind) {
    case 'cyclone':
      return p.vmax ?? 0;
    case 'wd':
      return p.amp ?? 0;
    case 'rain':
    case 'storm':
      return p.peak ?? 0;
    case 'heat':
    case 'cold':
      return Math.abs(p.mean ?? 0) * Math.sqrt((p.area ?? 0) / 1e4);
  }
}

export function motionOf(points: TrackPoint[]): Motion {
  const n = points.length;
  const speed = new Array<number>(n).fill(0);
  const heading = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const dt = b.t - a.t;
    if (dt <= 0) continue;
    speed[i] = distKm(a.lon, a.lat, b.lon, b.lat) / dt;
    heading[i] = bearingDeg(a.lon, a.lat, b.lon, b.lat);
  }
  return { speed, heading };
}

function smooth3(x: number[]): number[] {
  return x.map((v, i) => {
    const a = x[Math.max(0, i - 1)];
    const b = x[Math.min(x.length - 1, i + 1)];
    return 0.25 * a + 0.5 * v + 0.25 * b;
  });
}

const SLOPE_THRESHOLD: Record<EventKind, number> = { cyclone: 6, wd: 12, rain: 25, storm: 30, heat: 0, cold: 0 };

export function stagesOf(tr: RawTrack): Stage[] {
  const p = tr.points;
  const x = smooth3(p.map((q) => intensityOf(tr.kind, q)));
  const max = Math.max(...x, 1e-6);
  const thr = SLOPE_THRESHOLD[tr.kind] || 0.25 * max;
  const n = p.length;
  return p.map((q, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dt = p[b].t - p[a].t;
    const slope = dt > 0 ? ((x[b] - x[a]) / dt) * 24 : 0;
    const age = q.t - p[0].t;
    if (i === 0 || (age <= 12 && x[i] < 0.6 * max && slope >= -thr)) return 'genesis';
    if (i === n - 1 && tr.endReason !== 'window') return 'dissipating';
    if (slope > thr) return 'intensifying';
    if (slope < -thr) return x[i] < 0.45 * max ? 'dissipating' : 'weakening';
    return x[i] >= 0.85 * max ? 'mature' : 'steady';
  });
}

function refineLandfall(a: TrackPoint, b: TrackPoint): { lon: number; lat: number; t: number } {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 14; k++) {
    const m = (lo + hi) / 2;
    const lon = a.lon + (b.lon - a.lon) * m;
    const lat = a.lat + (b.lat - a.lat) * m;
    if (isLandPoint(lon, lat)) hi = m;
    else lo = m;
  }
  const f = (lo + hi) / 2;
  return { lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f, t: a.t + (b.t - a.t) * f };
}

export interface Landfall {
  t: number;
  lon: number;
  lat: number;
  vmax: number;
  cat: string;
  place: string;
  region: string;
  arcKm: number;
}

export function landfallOf(tr: RawTrack): Landfall | null {
  if (tr.kind !== 'cyclone') return null;
  const p = tr.points;
  for (let i = 1; i < p.length; i++) {
    if (!p[i - 1].overLand && p[i].overLand) {
      const lf = refineLandfall(p[i - 1], p[i]);
      const f = (lf.t - p[i - 1].t) / Math.max(1e-6, p[i].t - p[i - 1].t);
      const vmax = (p[i - 1].vmax ?? 0) + ((p[i].vmax ?? 0) - (p[i - 1].vmax ?? 0)) * f;
      const cp = coastPosition(lf.lon, lf.lat);
      const near = referenceCities(lf.lon, lf.lat, false, 1)[0];
      return {
        ...lf,
        vmax,
        cat: CYCLONE_SCALE.find((c, k) => vmax >= c.minKt && (k === CYCLONE_SCALE.length - 1 || vmax < CYCLONE_SCALE[k + 1].minKt))?.code ?? 'L',
        place: cp.dist < 160 ? cp.nearest.name : relativeTo(lf.lon, lf.lat, near),
        region: cp.dist < 160 ? cp.nearest.region : near.state,
        arcKm: cp.dist < 160 ? cp.arcKm : -1,
      };
    }
  }
  return null;
}

export function milestonesOf(tr: RawTrack, relations: Relation[], motion: Motion): Milestone[] {
  const p = tr.points;
  const out: Milestone[] = [];
  const m = (i: number, type: MilestoneType, label: string) => out.push({ t: p[i].t, type, label, lon: p[i].lon, lat: p[i].lat });
  const born = relations.find((r) => r.to === tr.id && r.type !== 'rainband' && r.type !== 'merge');
  if (!born) m(0, 'genesis', tr.kind === 'cyclone' ? `Formed as ${catName(p[0].cat).toLowerCase()}` : 'First detected');

  if (tr.kind === 'cyclone') {
    let best = catIndex(p[0].cat);
    let named = false;
    for (let i = 1; i < p.length; i++) {
      const c = catIndex(p[i].cat);
      if (c > best && c >= 2) {
        best = c;
        if (c >= 4 && !named) {
          named = true;
          m(i, 'named', `Intensified into a ${catName(p[i].cat).toLowerCase()}`);
        } else m(i, 'upgrade', `Intensified into a ${catName(p[i].cat).toLowerCase()}`);
      }
    }
    let peakI = 0;
    for (let i = 1; i < p.length; i++) if ((p[i].vmax ?? 0) > (p[peakI].vmax ?? 0)) peakI = i;
    if (catIndex(p[peakI].cat) >= 2) m(peakI, 'peak', `Peak intensity ${Math.round(p[peakI].vmax ?? 0)} kt`);
    for (let i = 0; i < p.length; i++) {
      const j = p.findIndex((q) => q.t === p[i].t + 24);
      if (j > 0 && (p[j].vmax ?? 0) - (p[i].vmax ?? 0) >= 30) {
        m(i, 'ri', `Rapid intensification: +${Math.round((p[j].vmax ?? 0) - (p[i].vmax ?? 0))} kt in 24 h`);
        break;
      }
    }
    const lf = landfallOf(tr);
    if (lf) out.push({ t: lf.t, type: 'landfall', label: `Landfall near ${lf.place}`, lon: lf.lon, lat: lf.lat });
    // Recurvature: westward motion turning eastward while heading north.
    for (let i = 2; i < p.length - 1; i++) {
      const hPrev = motion.heading[i - 2];
      const hNow = motion.heading[i];
      const westBefore = Math.sin((hPrev * Math.PI) / 180) < -0.2;
      const eastNow = Math.sin((hNow * Math.PI) / 180) > 0.2 && Math.cos((hNow * Math.PI) / 180) > -0.2;
      if (westBefore && eastNow && headingDelta(hPrev, hNow) > 45) {
        m(i, 'recurvature', 'Recurved towards the northeast');
        break;
      }
    }
    // Downgrades after the peak.
    let below = catIndex(p[peakI].cat);
    for (let i = peakI + 1; i < p.length; i++) {
      const c = catIndex(p[i].cat);
      if ((below >= 4 && c < 4) || (below >= 2 && c < 2)) {
        m(i, 'downgrade', `Weakened into a ${catName(p[i].cat).toLowerCase()}`);
        below = c;
      }
    }
  } else {
    let peakI = 0;
    for (let i = 1; i < p.length; i++) if (intensityOf(tr.kind, p[i]) > intensityOf(tr.kind, p[peakI])) peakI = i;
    if (p.length > 2) m(peakI, 'peak', 'Peak');
  }

  // Stall: slow motion for 12 h or more.
  let slowStart = -1;
  for (let i = 0; i < p.length; i++) {
    if (motion.speed[i] < 5 && i > 0) {
      if (slowStart < 0) slowStart = i;
      if (p[i].t - p[slowStart].t >= 12 && tr.kind === 'cyclone') {
        m(slowStart, 'stall', 'Nearly stationary');
        break;
      }
    } else slowStart = -1;
  }

  for (const r of relations) {
    if (r.to === tr.id && r.type !== 'rainband') {
      const i = p.findIndex((q) => q.t >= r.t);
      const type: MilestoneType = r.type === 'merge' ? 'merge' : r.type;
      if (i >= 0 && type !== 'merge') m(i, type, r.type === 'split' ? 'Split from parent system' : r.type === 'regenerated' ? 'Regenerated over the sea' : 'Induced by a western disturbance');
    }
    if (r.from === tr.id && r.type === 'merge') m(p.length - 1, 'merge', 'Merged into a stronger system');
  }
  const last = p.length - 1;
  if (tr.endReason === 'dissipated' && last > 0) m(last, 'dissipation', tr.kind === 'cyclone' ? 'Weakened into a remnant' : 'Dissipated');
  return out.sort((a, b) => a.t - b.t);
}
