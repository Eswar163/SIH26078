// Ensemble prediction: 21 members (control + 20 perturbed) run through the
// same pipeline at 0.5 degrees. Each member returns compact results so that
// members can be computed in parallel workers and aggregated anywhere.

import { heatWaveClass, coldWaveClass } from './imd';
import { ENS_GRID, FORECAST_HOURS, forecastRun } from './run';
import { makeSynthContext, staticFields } from './synth';
import type { World } from './world';
import type { EventTrack } from './events';
import { distKm } from './geo';

export const ENSEMBLE_SIZE = 21;
export const ENS_DAYS = 7;

export interface MemberPoint {
  t: number;
  lon: number;
  lat: number;
  vmax: number;
  pmin: number;
  rmw: number;
  r34: number;
  overLand: boolean;
  cat: string;
}

export interface MemberTrack {
  member: number;
  id: string;
  points: MemberPoint[];
}

export interface MemberResult {
  member: number;
  cyclones: MemberTrack[];
  rainHeavy: Uint8Array[];
  rainVeryHeavy: Uint8Array[];
  heat: Uint8Array[];
  cold: Uint8Array[];
  windMax: Float32Array;
}

export function runMember(world: World, member: number): MemberResult {
  const g = ENS_GRID;
  const n = g.nx * g.ny;
  const st = staticFields(makeSynthContext(world.season, g, world.seed, world.analysis));
  const rainHeavy: Uint8Array[] = [];
  const rainVeryHeavy: Uint8Array[] = [];
  const heat: Uint8Array[] = [];
  const cold: Uint8Array[] = [];
  const windMax = new Float32Array(n);
  const out = forecastRun(world, 0, { type: 'member', member }, g, ['cyclone'], false, (f, rain24) => {
    if (f.t <= 0) return;
    for (let k = 0; k < n; k++) {
      const s = Math.hypot(f.u10[k], f.v10[k]);
      if (s > windMax[k]) windMax[k] = s;
    }
    if (f.t % 24 === 0) {
      const rh = new Uint8Array(n);
      const rv = new Uint8Array(n);
      const hw = new Uint8Array(n);
      const cw = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        rh[k] = rain24[k] >= 64.5 ? 1 : 0;
        rv[k] = rain24[k] >= 115.6 ? 1 : 0;
        if (st.landFrac[k] >= 0.5) {
          hw[k] = heatWaveClass(f.tmax[k], st.tmaxNormal[k], st.elev[k], st.coastKm[k] < 40) > 0 ? 1 : 0;
          cw[k] = coldWaveClass(f.tmin[k], st.tminNormal[k], st.elev[k]) > 0 ? 1 : 0;
        }
      }
      rainHeavy.push(rh);
      rainVeryHeavy.push(rv);
      heat.push(hw);
      cold.push(cw);
    }
  });
  const cyclones: MemberTrack[] = out.events
    .filter((e) => e.kind === 'cyclone')
    .map((e) => ({
      member,
      id: e.id,
      points: e.points
        .filter((p) => p.t >= 0)
        .map((p) => ({
          t: p.t,
          lon: Math.round(p.lon * 100) / 100,
          lat: Math.round(p.lat * 100) / 100,
          vmax: Math.round((p.vmax ?? 0) * 10) / 10,
          pmin: Math.round((p.pmin ?? 1010) * 10) / 10,
          rmw: Math.round(p.rmw ?? 60),
          r34: Math.round(p.r34 ?? 0),
          overLand: p.overLand,
          cat: p.cat,
        })),
    }))
    .filter((m) => m.points.length > 0);
  return { member, cyclones, rainHeavy, rainVeryHeavy, heat, cold, windMax };
}

// ---------------------------------------------------------------------------

export interface EnsembleProducts {
  members: number;
  /** Member tracks matched to each deterministic cyclone event. */
  byEvent: Record<string, MemberTrack[]>;
  /** Member cyclones that the deterministic run does not have (possible genesis). */
  unmatched: MemberTrack[];
  rainHeavy: Float32Array[];
  rainVeryHeavy: Float32Array[];
  heat: Float32Array[];
  cold: Float32Array[];
  gale: Float32Array;
  storm: Float32Array;
  hurricane: Float32Array;
  genesis: Float32Array;
}

export function aggregate(events: EventTrack[], results: MemberResult[]): EnsembleProducts {
  const g = ENS_GRID;
  const n = g.nx * g.ny;
  const N = results.length;
  const days = Math.min(...results.map((r) => r.rainHeavy.length));
  const mean = (pick: (r: MemberResult) => Uint8Array[]) =>
    Array.from({ length: days }, (_, d) => {
      const a = new Float32Array(n);
      for (const r of results) {
        const m = pick(r)[d];
        for (let k = 0; k < n; k++) a[k] += m[k];
      }
      for (let k = 0; k < n; k++) a[k] /= N;
      return a;
    });
  const gale = new Float32Array(n);
  const storm = new Float32Array(n);
  const hurricane = new Float32Array(n);
  for (const r of results) {
    for (let k = 0; k < n; k++) {
      const kt = r.windMax[k] * 1.943844;
      if (kt >= 34) gale[k] += 1 / N;
      if (kt >= 50) storm[k] += 1 / N;
      if (kt >= 64) hurricane[k] += 1 / N;
    }
  }

  // Match member cyclones to deterministic events by early-track proximity.
  const cyc = events.filter((e) => e.kind === 'cyclone' && e.t1 >= 0);
  const byEvent: Record<string, MemberTrack[]> = {};
  for (const e of cyc) byEvent[e.id] = [];
  const unmatched: MemberTrack[] = [];
  for (const r of results) {
    const pairs: { e: EventTrack; m: MemberTrack; d: number }[] = [];
    for (const e of cyc) {
      for (const m of r.cyclones) {
        let s = 0;
        let c = 0;
        for (const p of m.points) {
          const q = e.points.find((x) => x.t === p.t);
          if (!q) continue;
          s += distKm(p.lon, p.lat, q.lon, q.lat);
          if (++c >= 4) break;
        }
        if (c === 0) continue;
        const d = s / c;
        if (d < 450) pairs.push({ e, m, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const usedE = new Set<string>();
    const usedM = new Set<string>();
    for (const p of pairs) {
      if (usedE.has(p.e.id) || usedM.has(p.m.id)) continue;
      usedE.add(p.e.id);
      usedM.add(p.m.id);
      byEvent[p.e.id].push(p.m);
    }
    for (const m of r.cyclones) if (!usedM.has(m.id)) unmatched.push(m);
  }

  // Genesis probability: new member systems reaching depression strength.
  const genesis = new Float32Array(n);
  for (const r of results) {
    const mask = new Uint8Array(n);
    for (const m of unmatched.filter((u) => u.member === r.member)) {
      const first = m.points[0];
      if (first.t <= 6 || !m.points.some((p) => p.vmax >= 17)) continue;
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          const lon = g.lon0 + i * g.d;
          const lat = g.lat0 + j * g.d;
          if (Math.abs(lat - first.lat) > 3.5 || Math.abs(lon - first.lon) > 4) continue;
          if (distKm(lon, lat, first.lon, first.lat) <= 300) mask[j * g.nx + i] = 1;
        }
      }
    }
    for (let k = 0; k < n; k++) genesis[k] += mask[k] / N;
  }

  return {
    members: N,
    byEvent,
    unmatched,
    rainHeavy: mean((r) => r.rainHeavy),
    rainVeryHeavy: mean((r) => r.rainVeryHeavy),
    heat: mean((r) => r.heat),
    cold: mean((r) => r.cold),
    gale,
    storm,
    hurricane,
    genesis,
  };
}

export const ENSEMBLE_HOURS = FORECAST_HOURS;
