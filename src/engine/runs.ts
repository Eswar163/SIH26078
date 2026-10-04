// Run-to-run consistency: how the forecast for the same system has moved over
// the last four model cycles. Forecasters call the back-and-forth "windshield
// wiper"; a steady drift is a trend worth acting on early.

import { distKm } from './geo';
import { ENS_GRID, forecastRun } from './run';
import type { EventTrack } from './events';
import type { World } from './world';

export const PREVIOUS_INITS = [-48, -36, -24, -12];

export interface RunTrack {
  init: number;
  points: { t: number; lon: number; lat: number; vmax: number; cat: string }[];
  landfall: { t: number; lon: number; lat: number; arcKm: number; place: string; region: string; vmax: number } | null;
  peak: number;
}

export interface PreviousRun {
  init: number;
  events: EventTrack[];
}

export function previousRuns(world: World, inits = PREVIOUS_INITS): PreviousRun[] {
  return inits.map((init) => ({ init, events: forecastRun(world, init, { type: 'det' }, ENS_GRID, ['cyclone', 'wd']).events }));
}

export interface RunTrend {
  eventId: string;
  runs: RunTrack[];
  landfallShiftKm: number[];
  landfallShiftH: number[];
  verdict: 'steady' | 'drifting' | 'flip-flopping' | 'new' | 'n/a';
  driftDirection?: string;
  note: string;
}

export function runTrend(ev: EventTrack, prev: PreviousRun[]): RunTrend {
  const runs: RunTrack[] = [];
  for (const pr of prev) {
    let best: { e: EventTrack; d: number } | null = null;
    for (const e of pr.events) {
      if (e.kind !== ev.kind) continue;
      let s = 0;
      let n = 0;
      for (const p of e.points) {
        if (p.t < Math.max(pr.init, ev.t0)) continue;
        const q = ev.points.find((x) => x.t === p.t);
        if (!q) continue;
        s += distKm(p.lon, p.lat, q.lon, q.lat);
        if (++n >= 6) break;
      }
      if (!n) continue;
      const d = s / n;
      if (d < 500 && (!best || d < best.d)) best = { e, d };
    }
    if (!best) continue;
    const e = best.e;
    runs.push({
      init: pr.init,
      points: e.points.filter((p) => p.t >= pr.init).map((p) => ({ t: p.t, lon: p.lon, lat: p.lat, vmax: p.vmax ?? p.amp ?? 0, cat: p.cat })),
      landfall: e.landfall
        ? { t: e.landfall.t, lon: e.landfall.lon, lat: e.landfall.lat, arcKm: e.landfall.arcKm, place: e.landfall.place, region: e.landfall.region, vmax: e.landfall.vmax }
        : null,
      peak: Math.max(...e.points.filter((p) => p.t >= pr.init).map((p) => p.vmax ?? 0)),
    });
  }
  const current: RunTrack = {
    init: 0,
    points: ev.points.filter((p) => p.t >= 0).map((p) => ({ t: p.t, lon: p.lon, lat: p.lat, vmax: p.vmax ?? p.amp ?? 0, cat: p.cat })),
    landfall: ev.landfall
      ? { t: ev.landfall.t, lon: ev.landfall.lon, lat: ev.landfall.lat, arcKm: ev.landfall.arcKm, place: ev.landfall.place, region: ev.landfall.region, vmax: ev.landfall.vmax }
      : null,
    peak: Math.max(0, ...ev.points.filter((p) => p.t >= 0).map((p) => p.vmax ?? 0)),
  };
  const all = [...runs, current];
  const lfs = all.filter((r) => r.landfall && r.landfall.arcKm >= 0);
  const shiftKm: number[] = [];
  const shiftH: number[] = [];
  for (let i = 1; i < lfs.length; i++) {
    shiftKm.push(lfs[i].landfall!.arcKm - lfs[i - 1].landfall!.arcKm);
    shiftH.push(lfs[i].landfall!.t - lfs[i - 1].landfall!.t);
  }
  let verdict: RunTrend['verdict'] = 'n/a';
  let note = '';
  let driftDirection: string | undefined;
  if (runs.length === 0) {
    verdict = 'new';
    note = 'First appeared in this run; no earlier cycles to compare.';
  } else if (shiftKm.length >= 2) {
    const signs = shiftKm.map((x) => (Math.abs(x) < 40 ? 0 : Math.sign(x)));
    const flips = signs.slice(1).filter((s, i) => s !== 0 && signs[i] !== 0 && s !== signs[i]).length;
    const net = shiftKm.reduce((a, b) => a + b, 0);
    if (flips >= 1 && Math.abs(net) < 150) {
      verdict = 'flip-flopping';
      note = 'Landfall point has swung back and forth between cycles; treat the exact location with caution.';
    } else if (Math.abs(net) >= 120 && signs.every((s) => s >= 0 || s <= 0)) {
      verdict = 'drifting';
      driftDirection = net > 0 ? 'eastward along the coast' : 'westward along the coast';
      note = `Landfall has moved about ${Math.round(Math.abs(net) / 10) * 10} km ${driftDirection} over the last ${lfs.length - 1} cycles.`;
    } else {
      verdict = 'steady';
      note = 'Successive cycles agree on the landfall area.';
    }
  } else if (lfs.length < all.length) {
    verdict = 'steady';
    note = lfs.length === 0 ? 'No cycle brings the system ashore within the forecast window.' : 'Some cycles do not make landfall within the window.';
  } else {
    verdict = 'steady';
    note = 'Track forecasts from earlier cycles are close to this one.';
  }
  return { eventId: ev.id, runs: all, landfallShiftKm: shiftKm, landfallShiftH: shiftH, verdict, driftDirection, note };
}
