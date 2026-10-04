// Verification. Because the atmosphere is synthetic, the truth is known, so
// every product can be scored: detection hit rates, track and intensity
// errors by lead time against a persistence baseline (CLIPER-style), and
// whether the truth stayed inside the probability cone as often as it should.

import { distKm, toLocal } from './geo';
import type { Cone } from './cone';
import type { Detection } from './detect';
import type { EventTrack } from './events';
import type { PreviousRun } from './runs';
import type { TruthTrack } from './run';

export interface LeadError {
  lead: number;
  n: number;
  track: number;
  intensity: number;
  persistence: number;
}

export interface Verification {
  detection: { pod: number; far: number; hits: number; misses: number; falseAlarms: number };
  leads: LeadError[];
  coneCoverage: { inside: number; total: number; expected: number } | null;
  skill: number | null;
}

/** Probability of detection and false-alarm ratio for cyclonic systems of depression strength. */
export function detectionScores(detections: Detection[][], times: number[], truth: TruthTrack[]): Verification['detection'] {
  let hits = 0;
  let misses = 0;
  let fa = 0;
  times.forEach((t, s) => {
    if (t > 0) return;
    const all = detections[s].filter((d) => d.kind === 'cyclone');
    const dets = all.filter((d) => (d.vmax ?? 0) >= 17);
    const tr = truth
      .filter((x) => x.kind === 'cyclone')
      .map((x) => {
        const k = x.t.indexOf(t);
        return k >= 0 ? { lon: x.lon[k], lat: x.lat[k], v: x.v[k] } : null;
      })
      .filter((x): x is { lon: number; lat: number; v: number } => !!x);
    const strong = tr.filter((x) => x.v >= 17);
    for (const x of strong) {
      if (all.some((d) => distKm(d.lon, d.lat, x.lon, x.lat) < 200)) hits++;
      else misses++;
    }
    for (const d of dets) if (!tr.some((x) => x.v >= 10 && distKm(d.lon, d.lat, x.lon, x.lat) < 250)) fa++;
  });
  return {
    pod: hits + misses ? hits / (hits + misses) : 1,
    far: hits + fa ? fa / (hits + fa) : 0,
    hits,
    misses,
    falseAlarms: fa,
  };
}

function truthAt(tr: TruthTrack, t: number) {
  const k = tr.t.indexOf(t);
  return k >= 0 ? { lon: tr.lon[k], lat: tr.lat[k], v: tr.v[k] } : null;
}

/** Track and intensity errors by lead for a set of forecasts started at various inits. */
export function leadErrors(
  forecasts: { init: number; events: EventTrack[] }[],
  truth: TruthTrack[],
  validUntil: number,
  leads = [0, 12, 24, 36, 48, 72, 96, 120],
): LeadError[] {
  const acc = new Map<number, { n: number; track: number; inten: number; pers: number }>();
  for (const f of forecasts) {
    for (const ev of f.events) {
      if (ev.kind !== 'cyclone' || ev.truthId === undefined) continue;
      const tr = truth.find((x) => x.id === ev.truthId);
      if (!tr) continue;
      const p0 = ev.points.find((p) => p.t === f.init);
      const pPrev = ev.points.find((p) => p.t === f.init - 12);
      for (const lead of leads) {
        const t = f.init + lead;
        if (t > validUntil) continue;
        const p = ev.points.find((q) => q.t === t);
        const x = truthAt(tr, t);
        if (!p || !x || x.v < 17) continue;
        const a = acc.get(lead) ?? { n: 0, track: 0, inten: 0, pers: 0 };
        a.n++;
        a.track += distKm(p.lon, p.lat, x.lon, x.lat);
        a.inten += Math.abs((p.vmax ?? 0) - x.v);
        if (p0 && pPrev) {
          // Persistence: keep the last 12 h motion going.
          const f2 = lead / 12;
          const lon = p0.lon + (p0.lon - pPrev.lon) * f2;
          const lat = p0.lat + (p0.lat - pPrev.lat) * f2;
          a.pers += distKm(lon, lat, x.lon, x.lat);
        } else a.pers += distKm(p.lon, p.lat, x.lon, x.lat);
        acc.set(lead, a);
      }
    }
  }
  return leads
    .filter((l) => acc.has(l))
    .map((lead) => {
      const a = acc.get(lead)!;
      return { lead, n: a.n, track: a.track / a.n, intensity: a.inten / a.n, persistence: a.pers / a.n };
    });
}

/** Fraction of lead times at which the truth fell inside the 67% ellipse. */
export function coneCoverage(cone: Cone, truth: TruthTrack | undefined): Verification['coneCoverage'] {
  if (!truth) return null;
  let inside = 0;
  let total = 0;
  for (const e of cone.ellipses) {
    if (e.t <= 0) continue;
    const x = truthAt(truth, e.t);
    if (!x) continue;
    const [dx, dy] = toLocal(e.lon, e.lat, x.lon, x.lat);
    const th = ((90 - e.angle) * Math.PI) / 180;
    const u = dx * Math.cos(th) + dy * Math.sin(th);
    const v = -dx * Math.sin(th) + dy * Math.cos(th);
    total++;
    if ((u / e.a) ** 2 + (v / e.b) ** 2 <= 1) inside++;
  }
  return total ? { inside, total, expected: 0.67 } : null;
}

export function verify(
  current: { events: EventTrack[]; detections: Detection[][]; times: number[] },
  prev: PreviousRun[],
  truth: TruthTrack[],
  reveal: boolean,
  cones: Cone[],
): Verification {
  const detection = detectionScores(current.detections, current.times, truth);
  const validUntil = reveal ? 168 : 0;
  const forecasts = [...prev.map((p) => ({ init: p.init, events: p.events })), ...(reveal ? [{ init: 0, events: current.events }] : [])];
  const leads = leadErrors(forecasts, truth, validUntil);
  let coverage: Verification['coneCoverage'] = null;
  if (reveal) {
    let inside = 0;
    let total = 0;
    for (const c of cones) {
      const ev = current.events.find((e) => e.id === c.eventId);
      const cc = coneCoverage(c, truth.find((x) => x.id === ev?.truthId));
      if (cc) {
        inside += cc.inside;
        total += cc.total;
      }
    }
    coverage = total ? { inside, total, expected: 0.67 } : null;
  }
  const l48 = leads.find((l) => l.lead === 48) ?? leads.find((l) => l.lead === 24);
  const skill = l48 && l48.persistence > 0 ? 1 - l48.track / l48.persistence : null;
  return { detection, leads, coneCoverage: coverage, skill };
}
