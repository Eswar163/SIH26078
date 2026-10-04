// Decision support: impact-based colour-coded warnings for each city and day,
// and a "decision clock" for protective actions.
//
// Warnings follow the likelihood x impact matrix. The decision clock uses the
// classic cost-loss rule (act when the probability exceeds the cost/loss ratio
// of the action) together with the lead time each action needs, and reports
// the last responsible moment to act.

import { coldWaveClass, heatWaveClass, likelihoodClass, riskMatrix, type WarnLevel } from './imd';
import { CITIES, type City } from './places';
import { sample, type GridSpec } from './grid';
import type { Cone } from './cone';
import type { EnsembleProducts } from './ensemble';
import type { FieldSet } from './synth';

export type HazardType = 'wind' | 'rain' | 'heat' | 'cold';

export interface DayHazard {
  type: HazardType;
  p: number;
  impact: number;
  level: WarnLevel;
  text: string;
  eventId?: string;
}

export interface CityDay {
  day: number;
  level: WarnLevel;
  hazards: DayHazard[];
}

export interface CityOutlook {
  city: City;
  days: CityDay[];
  maxLevel: WarnLevel;
}

export interface DecisionInputs {
  cones: Cone[];
  ens: EnsembleProducts | null;
  ensGrid: GridSpec;
  det: { fields: FieldSet[]; times: number[]; grid: GridSpec; statics: { tmaxNormal: Float32Array; tminNormal: Float32Array; elev: Float32Array; coastKm: Float32Array } };
  days?: number;
}

const DAYS = 5;

function detDaily(inp: DecisionInputs, city: City, day: number) {
  const { fields, times, grid, statics } = inp.det;
  const t = day * 24;
  let rain24 = 0;
  for (let h = t - 18; h <= t; h += 6) {
    const k = times.indexOf(h);
    if (k >= 0) rain24 += sample(grid, fields[k].rain6, city.lon, city.lat);
  }
  const k = times.indexOf(t);
  if (k < 0) return { rain24, heat: 0, cold: 0, tmax: NaN, tmin: NaN };
  const f = fields[k];
  const tmax = sample(grid, f.tmax, city.lon, city.lat);
  const tmin = sample(grid, f.tmin, city.lon, city.lat);
  const nmax = sample(grid, statics.tmaxNormal, city.lon, city.lat);
  const nmin = sample(grid, statics.tminNormal, city.lon, city.lat);
  const elev = sample(grid, statics.elev, city.lon, city.lat);
  const coast = sample(grid, statics.coastKm, city.lon, city.lat);
  return {
    rain24,
    heat: heatWaveClass(tmax, nmax, elev, city.coastal && coast < 40),
    cold: coldWaveClass(tmin, nmin, elev),
    tmax,
    tmin,
  };
}

export function cityOutlooks(inp: DecisionInputs): CityOutlook[] {
  const days = inp.days ?? DAYS;
  const out: CityOutlook[] = [];
  for (const city of CITIES) {
    if (city.country !== 'India') continue;
    const cd: CityDay[] = [];
    for (let day = 1; day <= days; day++) {
      const hazards: DayHazard[] = [];
      // Wind from each cyclone cone.
      for (const cone of inp.cones) {
        const ct = cone.cities.find((c) => c.city.id === city.id);
        if (!ct || ct.pGale <= 0) continue;
        const from = (day - 1) * 24;
        const to = day * 24;
        const hits = ct.arrivals.filter((a) => a < to && a + 18 >= from).length;
        const p = hits / Math.max(1, inp.ens?.members ?? 21);
        if (p <= 0) continue;
        const impact = ct.pHurricane >= 0.15 ? 3 : ct.pStorm >= 0.15 ? 2 : 1;
        hazards.push({
          type: 'wind',
          p,
          impact,
          level: riskMatrix(likelihoodClass(p), impact),
          text: impact === 3 ? 'very severe cyclonic winds' : impact === 2 ? 'storm-force winds' : 'gale-force winds',
          eventId: cone.eventId,
        });
      }
      const det = detDaily(inp, city, day);
      // Rain.
      if (inp.ens && inp.ens.rainHeavy[day - 1]) {
        const ph = sample(inp.ensGrid, inp.ens.rainHeavy[day - 1], city.lon, city.lat);
        const pv = sample(inp.ensGrid, inp.ens.rainVeryHeavy[day - 1], city.lon, city.lat);
        if (ph >= 0.05) {
          const impact = pv >= 0.25 ? 3 : 2;
          const p = impact === 3 ? Math.max(pv, ph * 0.8) : ph;
          hazards.push({ type: 'rain', p, impact, level: riskMatrix(likelihoodClass(p), impact), text: impact === 3 ? 'very heavy rain' : 'heavy rain' });
        }
      } else if (det.rain24 >= 64.5) {
        const impact = det.rain24 >= 115.6 ? 3 : 2;
        hazards.push({ type: 'rain', p: 0.5, impact, level: riskMatrix(2, impact), text: impact === 3 ? 'very heavy rain' : 'heavy rain' });
      }
      // Heat and cold.
      const heatP = inp.ens?.heat[day - 1] ? sample(inp.ensGrid, inp.ens.heat[day - 1], city.lon, city.lat) : det.heat > 0 ? 0.5 : 0;
      if (heatP >= 0.1) {
        const impact = det.heat === 2 || det.tmax >= 45 ? 3 : 2;
        hazards.push({ type: 'heat', p: heatP, impact, level: riskMatrix(likelihoodClass(heatP), impact), text: impact === 3 ? 'severe heat wave' : 'heat wave' });
      }
      const coldP = inp.ens?.cold[day - 1] ? sample(inp.ensGrid, inp.ens.cold[day - 1], city.lon, city.lat) : det.cold > 0 ? 0.5 : 0;
      if (coldP >= 0.1) {
        const impact = det.cold === 2 ? 3 : 2;
        hazards.push({ type: 'cold', p: coldP, impact, level: riskMatrix(likelihoodClass(coldP), impact), text: impact === 3 ? 'severe cold wave' : 'cold wave' });
      }
      hazards.sort((a, b) => b.level - a.level || b.p - a.p);
      cd.push({ day, level: (hazards[0]?.level ?? 0) as WarnLevel, hazards });
    }
    const maxLevel = Math.max(0, ...cd.map((d) => d.level)) as WarnLevel;
    out.push({ city, days: cd, maxLevel });
  }
  return out.sort((a, b) => b.maxLevel - a.maxLevel || b.city.pop - a.city.pop);
}

export interface ExposureRow {
  day: number;
  people: [number, number, number, number];
}

/** Approximate city population (thousands) under each warning colour, per day. */
export function exposure(outlooks: CityOutlook[]): ExposureRow[] {
  const days = outlooks[0]?.days.length ?? 0;
  return Array.from({ length: days }, (_, d) => {
    const people: [number, number, number, number] = [0, 0, 0, 0];
    for (const o of outlooks) people[o.days[d].level] += o.city.pop;
    return { day: d + 1, people };
  });
}

// ---------------------------------------------------------------------------
// Decision clock

export interface ActionSpec {
  id: string;
  label: string;
  hazard: HazardType;
  /** Act when probability >= this (the action's cost/loss ratio). */
  threshold: number;
  /** Hours of lead time the action needs. */
  lead: number;
  coastalOnly?: boolean;
  severe?: boolean;
}

export const ACTIONS: ActionSpec[] = [
  { id: 'boats', label: 'Recall fishing boats', hazard: 'wind', threshold: 0.1, lead: 48, coastalOnly: true },
  { id: 'evacuate', label: 'Evacuate low-lying coastal areas', hazard: 'wind', threshold: 0.3, lead: 24, coastalOnly: true, severe: true },
  { id: 'ndrf', label: 'Pre-position NDRF teams', hazard: 'wind', threshold: 0.25, lead: 36 },
  { id: 'power', label: 'Stage power restoration crews', hazard: 'wind', threshold: 0.35, lead: 24 },
  { id: 'schools', label: 'Close schools and colleges', hazard: 'rain', threshold: 0.5, lead: 12 },
  { id: 'flood', label: 'Open flood control rooms, clear drains', hazard: 'rain', threshold: 0.35, lead: 24 },
  { id: 'cooling', label: 'Open cooling centres, shift outdoor work', hazard: 'heat', threshold: 0.4, lead: 24 },
  { id: 'shelters', label: 'Open night shelters', hazard: 'cold', threshold: 0.4, lead: 24 },
];

export type ClockStatus = 'act-now' | 'act-by' | 'prepare' | 'monitor';

export interface Decision {
  city: City;
  action: ActionSpec;
  p: number;
  arrival: { p10: number; p50: number; p90: number } | null;
  lastMoment: number | null;
  status: ClockStatus;
  eventId?: string;
}

export function decisionClock(outlooks: CityOutlook[], cones: Cone[], members: number): Decision[] {
  const out: Decision[] = [];
  for (const o of outlooks) {
    if (o.maxLevel === 0) continue;
    for (const action of ACTIONS) {
      if (action.coastalOnly && !o.city.coastal) continue;
      let p = 0;
      let arrival: Decision['arrival'] = null;
      let eventId: string | undefined;
      if (action.hazard === 'wind') {
        for (const cone of cones) {
          const ct = cone.cities.find((c) => c.city.id === o.city.id);
          if (!ct) continue;
          const pp = action.severe ? ct.pStorm : ct.pGale;
          if (pp > p) {
            p = pp;
            eventId = cone.eventId;
            const arr = [...ct.arrivals].sort((a, b) => a - b);
            if (arr.length) {
              const q = (x: number) => arr[Math.min(arr.length - 1, Math.floor(x * (arr.length - 1)))];
              arrival = { p10: q(0.1), p50: q(0.5), p90: q(0.9) };
            }
          }
        }
        void members;
      } else {
        for (const d of o.days) {
          const h = d.hazards.find((x) => x.type === action.hazard);
          if (!h) continue;
          if (h.p > p) p = h.p;
          if (!arrival && h.p >= action.threshold * 0.5) arrival = { p10: (d.day - 1) * 24, p50: (d.day - 1) * 24 + 12, p90: d.day * 24 };
        }
      }
      if (p < action.threshold * 0.5) continue;
      const lastMoment = arrival ? arrival.p10 - action.lead : null;
      let status: ClockStatus = 'monitor';
      if (p >= action.threshold) status = lastMoment !== null && lastMoment > 6 ? 'act-by' : 'act-now';
      else status = 'prepare';
      out.push({ city: o.city, action, p, arrival, lastMoment, status, eventId });
    }
  }
  const rank: Record<ClockStatus, number> = { 'act-now': 0, 'act-by': 1, prepare: 2, monitor: 3 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || (a.lastMoment ?? 999) - (b.lastMoment ?? 999) || b.p - a.p);
}
