// The future probability cone, built from the ensemble rather than from a
// fixed historical error table:
//
// - an uncertainty ellipse at each lead time from the members' position
//   covariance (so the cone stretches along-track when timing is uncertain
//   and across-track when direction is),
// - a smooth envelope through the ellipses,
// - strike probability (centre within 120 km),
// - landfall probability along the coastline,
// - wind-threshold probability and arrival-time spread for each city,
// - an intensity fan (percentiles by lead time).

import { distKm, fromLocal, toLocal } from './geo';
import { type GridSpec } from './grid';
import { isLandPoint } from './land';
import { CITIES, COAST_LENGTH, coastPosition, coastPointAt, coastRegionAt, type City } from './places';
import type { MemberPoint, MemberTrack } from './ensemble';
import type { EventTrack } from './events';

export interface Ellipse {
  t: number;
  lon: number;
  lat: number;
  /** Semi-axes (km) for the 67% region, and orientation of the major axis (degrees clockwise from north). */
  a: number;
  b: number;
  angle: number;
  n: number;
  survival: number;
  vmax: { p10: number; p25: number; p50: number; p75: number; p90: number };
  /** Member intensities at this lead (kt). */
  vs: number[];
  spreadKm: number;
}

export interface LandfallStats {
  probability: number;
  members: number;
  points: { member: number; arcKm: number; t: number; vmax: number; lon: number; lat: number; region: string }[];
  density: { arcKm: number; p: number }[];
  likely?: { from: number; to: number; fromName: string; toName: string; probability: number };
  time?: { p10: number; p50: number; p90: number };
  vmax?: { p10: number; p50: number; p90: number };
  byRegion: { region: string; p: number }[];
}

export interface CityThreat {
  city: City;
  pNear: number;
  pGale: number;
  pStorm: number;
  pHurricane: number;
  arrival?: { p10: number; p50: number; p90: number };
  maxWindP50: number;
  /** Per-member gale arrival times (h), for daily probabilities. */
  arrivals: number[];
}

export interface Cone {
  eventId: string;
  members: number;
  ellipses: Ellipse[];
  envelope67: number[];
  envelope90: number[];
  meanTrack: [number, number, number][];
  strike: Float32Array;
  landfall: LandfallStats;
  cities: CityThreat[];
  /** Mean member spread (km) at `spreadLead`. */
  spread72: number | null;
  /** Lead (h) at which the spread used for confidence was measured. */
  spreadLead: number | null;
  confidence: 'high' | 'moderate' | 'low';
}

const K67 = Math.sqrt(-2 * Math.log(1 - 0.67));
const K90 = Math.sqrt(-2 * Math.log(1 - 0.9));

function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * Members run on a coarser grid and under-read intensity, increasingly so as
 * the eyewall shrinks below the grid spacing. Fit a power law v_det = a * v^b
 * between the full-resolution run and the member median over every cyclone and
 * lead time in this run, then map every member through it. Members keep their
 * own variability; only the resolution bias is removed.
 */
export function fitIntensityMapping(events: EventTrack[], byEvent: Record<string, MemberTrack[]>): (v: number) => number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const ev of events) {
    const members = byEvent[ev.id];
    if (!members || members.length < 3) continue;
    for (const p of ev.points) {
      if (p.t < Math.max(0, ev.t0) || !p.vmax || p.vmax < 15) continue;
      const vs = members.map((m) => m.points.find((q) => q.t === p.t)?.vmax).filter((v): v is number => !!v && v >= 10);
      if (vs.length < 3) continue;
      const med = [...vs].sort((a, b) => a - b)[Math.floor(vs.length / 2)];
      xs.push(Math.log(med));
      ys.push(Math.log(p.vmax));
    }
  }
  if (xs.length < 4) return (v) => v;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const b = Math.max(0.8, Math.min(1.8, sxx > 1e-6 ? sxy / sxx : 1));
  const lnA = my - b * mx;
  return (v) => (v <= 10 ? v * Math.exp(lnA + b * Math.log(10)) / 10 : Math.exp(lnA + b * Math.log(v)));
}

export function mapMembers(members: MemberTrack[], f: (v: number) => number): MemberTrack[] {
  return members.map((m) => ({ ...m, points: m.points.map((p) => ({ ...p, vmax: f(p.vmax) })) }));
}

export function buildCone(ev: EventTrack, members: MemberTrack[], N: number, grid: GridSpec, inflation = 1.15): Cone {
  const start = Math.max(0, ev.t0);
  const times: number[] = [];
  for (let t = start; t <= 168; t += 6) times.push(t);
  const ellipses: Ellipse[] = [];
  for (const t of times) {
    const pts: MemberPoint[] = [];
    for (const m of members) {
      const p = m.points.find((q) => q.t === t);
      if (p) pts.push(p);
    }
    const det = ev.points.find((q) => q.t === t);
    if (pts.length < Math.max(3, 0.2 * N)) break;
    const lon0 = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
    const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    const xy = pts.map((p) => toLocal(lon0, lat0, p.lon, p.lat));
    for (const [x, y] of xy) {
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
    const nn = Math.max(1, pts.length - 1);
    const lead = t - start;
    const floor = (18 + 0.35 * lead) ** 2;
    sxx = (sxx / nn) * inflation ** 2 + floor;
    syy = (syy / nn) * inflation ** 2 + floor;
    sxy = (sxy / nn) * inflation ** 2;
    const tr = sxx + syy;
    const det2 = sxx * syy - sxy * sxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det2));
    const l1 = tr / 2 + disc;
    const l2 = Math.max(1, tr / 2 - disc);
    // Major-axis direction in (east, north) coordinates, converted to a compass angle.
    const ang = Math.atan2(l1 - sxx, sxy || 1e-9);
    const angle = ((90 - (ang * 180) / Math.PI) % 360 + 360) % 360;
    const spread = xy.reduce((s, [x, y]) => s + Math.hypot(x, y), 0) / xy.length;
    const v = pts.map((p) => p.vmax);
    ellipses.push({
      t,
      lon: lon0,
      lat: lat0,
      a: K67 * Math.sqrt(l1),
      b: K67 * Math.sqrt(l2),
      angle,
      n: pts.length,
      survival: pts.length / N,
      vmax: { p10: quantile(v, 0.1), p25: quantile(v, 0.25), p50: quantile(v, 0.5), p75: quantile(v, 0.75), p90: quantile(v, 0.9) },
      vs: v.map((x) => Math.round(x)),
      spreadKm: spread,
    });
    void det;
  }

  const envelope = (k: number) => envelopeOf(ellipses, k / K67);
  const meanTrack = ellipses.map((e) => [e.t, e.lon, e.lat] as [number, number, number]);
  const strike = strikeProbability(members, N, grid, start);
  const landfall = landfallStats(ev, members, N, start);
  const cities = cityThreats(members, N, start);
  const e72 = ellipses.find((e) => e.t === start + 72);
  const ref = e72 ?? [...ellipses].reverse().find((e) => e.t - start >= 24 && e.t - start <= 72) ?? null;
  const spreadLead = ref ? ref.t - start : null;
  const spread72 = ref ? ref.spreadKm : null;
  let confidence: Cone['confidence'] = 'moderate';
  if (ref && spreadLead) {
    const perHour = ref.spreadKm / spreadLead;
    confidence = perHour < 1.7 ? 'high' : perHour < 3.2 ? 'moderate' : 'low';
  }
  return {
    eventId: ev.id,
    members: members.length,
    ellipses,
    envelope67: envelope(K67),
    envelope90: envelope(K90),
    meanTrack,
    strike,
    landfall,
    cities,
    spread72,
    spreadLead,
    confidence,
  };
}

/** Smooth outline through a sequence of ellipses: left edge forward, end cap, right edge back. */
function envelopeOf(ellipses: Ellipse[], scale: number): number[] {
  if (ellipses.length === 0) return [];
  const halfWidth = (e: Ellipse, nx: number, ny: number) => {
    // Support function of the ellipse in direction (nx, ny) (east, north).
    const th = ((90 - e.angle) * Math.PI) / 180; // major axis as math angle
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    const pa = nx * ux + ny * uy;
    const pb = -nx * uy + ny * ux;
    return scale * Math.sqrt((e.a * pa) ** 2 + (e.b * pb) ** 2);
  };
  const left: number[][] = [];
  const right: number[][] = [];
  for (let i = 0; i < ellipses.length; i++) {
    const e = ellipses[i];
    const a = ellipses[Math.max(0, i - 1)];
    const b = ellipses[Math.min(ellipses.length - 1, i + 1)];
    let [dx, dy] = toLocal(e.lon, e.lat, b.lon, b.lat);
    const [ax, ay] = toLocal(e.lon, e.lat, a.lon, a.lat);
    dx -= ax;
    dy -= ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = halfWidth(e, nx, ny);
    left.push(fromLocal(e.lon, e.lat, nx * w, ny * w));
    right.push(fromLocal(e.lon, e.lat, -nx * w, -ny * w));
  }
  const last = ellipses[ellipses.length - 1];
  const cap: number[][] = [];
  const th0 = ((90 - last.angle) * Math.PI) / 180;
  for (let k = 0; k <= 24; k++) {
    const phi = (k / 24) * Math.PI * 2;
    const x = scale * (last.a * Math.cos(phi) * Math.cos(th0) - last.b * Math.sin(phi) * Math.sin(th0));
    const y = scale * (last.a * Math.cos(phi) * Math.sin(th0) + last.b * Math.sin(phi) * Math.cos(th0));
    cap.push(fromLocal(last.lon, last.lat, x, y));
  }
  // Keep only the cap points ahead of the track's end, ordered from left to right.
  const prev = ellipses[Math.max(0, ellipses.length - 2)];
  const [fx, fy] = toLocal(last.lon, last.lat, prev.lon, prev.lat);
  const ahead = cap.filter((p) => {
    const [x, y] = toLocal(last.lon, last.lat, p[0], p[1]);
    return x * fx + y * fy <= 0;
  });
  const lEnd = left[left.length - 1];
  ahead.sort((p, q) => {
    const dp = (p[0] - lEnd[0]) ** 2 + (p[1] - lEnd[1]) ** 2;
    const dq = (q[0] - lEnd[0]) ** 2 + (q[1] - lEnd[1]) ** 2;
    return dp - dq;
  });
  const ring = [...left, ...orderCap(ahead, lEnd), ...right.reverse()];
  const flat: number[] = [];
  for (const p of ring) flat.push(Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000);
  if (ring.length) flat.push(flat[0], flat[1]);
  return flat;
}

/** Order cap points into a path starting near `from` (greedy nearest neighbour). */
function orderCap(points: number[][], from: number[]): number[][] {
  const rest = [...points];
  const out: number[][] = [];
  let cur = from;
  while (rest.length) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const d = (rest[i][0] - cur[0]) ** 2 + (rest[i][1] - cur[1]) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    cur = rest.splice(bi, 1)[0];
    out.push(cur);
  }
  return out;
}

export function strikeProbability(members: MemberTrack[], N: number, g: GridSpec, start: number, radius = 120): Float32Array {
  const out = new Float32Array(g.nx * g.ny);
  for (const m of members) {
    const mask = new Uint8Array(g.nx * g.ny);
    const pts = m.points.filter((p) => p.t >= start);
    for (let s = 0; s < pts.length; s++) {
      const a = pts[s];
      const b = pts[Math.min(pts.length - 1, s + 1)];
      const minLon = Math.min(a.lon, b.lon) - 1.5;
      const maxLon = Math.max(a.lon, b.lon) + 1.5;
      const minLat = Math.min(a.lat, b.lat) - 1.2;
      const maxLat = Math.max(a.lat, b.lat) + 1.2;
      const i0 = Math.max(0, Math.floor((minLon - g.lon0) / g.d));
      const i1 = Math.min(g.nx - 1, Math.ceil((maxLon - g.lon0) / g.d));
      const j0 = Math.max(0, Math.floor((minLat - g.lat0) / g.d));
      const j1 = Math.min(g.ny - 1, Math.ceil((maxLat - g.lat0) / g.d));
      const [bx, by] = toLocal(a.lon, a.lat, b.lon, b.lat);
      const len2 = bx * bx + by * by;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * g.nx + i;
          if (mask[k]) continue;
          const [px, py] = toLocal(a.lon, a.lat, g.lon0 + i * g.d, g.lat0 + j * g.d);
          const f = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
          if (Math.hypot(px - f * bx, py - f * by) <= radius) mask[k] = 1;
        }
      }
    }
    for (let k = 0; k < out.length; k++) out[k] += mask[k] / N;
  }
  return out;
}

function landfallStats(ev: EventTrack, members: MemberTrack[], N: number, start: number): LandfallStats {
  const points: LandfallStats['points'] = [];
  for (const m of members) {
    const p = m.points.filter((q) => q.t >= start);
    if (p.length && p[0].overLand) continue;
    for (let i = 1; i < p.length; i++) {
      if (!p[i - 1].overLand && p[i].overLand) {
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) / 2;
          if (isLandPoint(p[i - 1].lon + (p[i].lon - p[i - 1].lon) * mid, p[i - 1].lat + (p[i].lat - p[i - 1].lat) * mid)) hi = mid;
          else lo = mid;
        }
        const f = (lo + hi) / 2;
        const lon = p[i - 1].lon + (p[i].lon - p[i - 1].lon) * f;
        const lat = p[i - 1].lat + (p[i].lat - p[i - 1].lat) * f;
        const cp = coastPosition(lon, lat);
        const region = cp.dist < 200 ? coastRegionAt(cp.arcKm) : 'Sri Lanka or islands';
        points.push({
          member: m.member,
          arcKm: cp.dist < 200 ? cp.arcKm : -1,
          t: p[i - 1].t + (p[i].t - p[i - 1].t) * f,
          vmax: p[i - 1].vmax + (p[i].vmax - p[i - 1].vmax) * f,
          lon,
          lat,
          region,
        });
        break;
      }
    }
  }
  const onCoast = points.filter((p) => p.arcKm >= 0);
  const density: { arcKm: number; p: number }[] = [];
  const bw = 70;
  for (let x = 0; x <= COAST_LENGTH; x += 15) {
    let s = 0;
    for (const p of onCoast) s += Math.exp(-0.5 * ((x - p.arcKm) / bw) ** 2);
    // Probability per 100 km of coast.
    density.push({ arcKm: x, p: (s / (N * bw * Math.sqrt(2 * Math.PI))) * 100 });
  }
  let likely: LandfallStats['likely'];
  if (onCoast.length >= 3) {
    const xs = onCoast.map((p) => p.arcKm).sort((a, b) => a - b);
    const need = Math.ceil(xs.length * 0.5);
    let best = { from: xs[0], to: xs[xs.length - 1] };
    for (let i = 0; i + need - 1 < xs.length; i++) {
      if (xs[i + need - 1] - xs[i] < best.to - best.from) best = { from: xs[i], to: xs[i + need - 1] };
    }
    const pad = 25;
    likely = {
      from: best.from - pad,
      to: best.to + pad,
      fromName: coastPointAt(best.from).name,
      toName: coastPointAt(best.to).name,
      probability: need / N,
    };
  }
  const regions = new Map<string, number>();
  for (const p of points) regions.set(p.region, (regions.get(p.region) ?? 0) + 1 / N);
  const tt = points.map((p) => p.t);
  const vv = points.map((p) => p.vmax);
  void ev;
  return {
    probability: points.length / N,
    members: points.length,
    points,
    density,
    likely,
    time: tt.length ? { p10: quantile(tt, 0.1), p50: quantile(tt, 0.5), p90: quantile(tt, 0.9) } : undefined,
    vmax: vv.length ? { p10: quantile(vv, 0.1), p50: quantile(vv, 0.5), p90: quantile(vv, 0.9) } : undefined,
    byRegion: [...regions.entries()].map(([region, p]) => ({ region, p })).sort((a, b) => b.p - a.p),
  };
}

/** Wind (kt) at distance d (km) from a centre with max wind vmax at radius rmw. */
export function windAtDistance(vmax: number, rmw: number, d: number): number {
  const r = Math.max(10, rmw);
  if (d <= r) return vmax * (0.35 + 0.65 * (d / r));
  return vmax * Math.pow(r / d, 0.58);
}

function cityThreats(members: MemberTrack[], N: number, start: number): CityThreat[] {
  const out: CityThreat[] = [];
  for (const city of CITIES) {
    let near = 0;
    let gale = 0;
    let storm = 0;
    let hur = 0;
    const arrivals: number[] = [];
    const maxW: number[] = [];
    let touched = false;
    for (const m of members) {
      let minD = Infinity;
      let wmax = 0;
      let arrival = Infinity;
      const p = m.points.filter((q) => q.t >= start);
      for (let i = 0; i < p.length; i++) {
        const a = p[i];
        const b = p[Math.min(p.length - 1, i + 1)];
        for (let h = 0; h < 6; h += 2) {
          const f = h / 6;
          const lon = a.lon + (b.lon - a.lon) * f;
          const lat = a.lat + (b.lat - a.lat) * f;
          if (Math.abs(lat - city.lat) > 8 || Math.abs(lon - city.lon) > 9) continue;
          const d = distKm(lon, lat, city.lon, city.lat);
          const vm = a.vmax + (b.vmax - a.vmax) * f;
          const rm = a.rmw + (b.rmw - a.rmw) * f;
          const w = windAtDistance(vm, rm, d) * (city.coastal ? 1 : 0.85);
          if (d < minD) minD = d;
          if (w > wmax) wmax = w;
          if (w >= 34 && a.t + h < arrival) arrival = a.t + h;
        }
      }
      if (minD < 1500) touched = true;
      if (minD <= 100) near++;
      if (wmax >= 34) gale++;
      if (wmax >= 50) storm++;
      if (wmax >= 64) hur++;
      if (Number.isFinite(arrival)) arrivals.push(arrival);
      maxW.push(wmax);
    }
    if (!touched) continue;
    const t: CityThreat = {
      city,
      pNear: near / N,
      pGale: gale / N,
      pStorm: storm / N,
      pHurricane: hur / N,
      maxWindP50: quantile(maxW.concat(new Array(Math.max(0, N - maxW.length)).fill(0)), 0.5),
      arrivals,
    };
    if (arrivals.length >= 2) t.arrival = { p10: quantile(arrivals, 0.1), p50: quantile(arrivals, 0.5), p90: quantile(arrivals, 0.9) };
    if (t.pGale > 0 || t.pNear > 0) out.push(t);
  }
  return out.sort((a, b) => b.pGale - a.pGale || b.pNear - a.pNear);
}
