// Warning drill: compare issued colour-coded warnings with what the hidden
// truth actually produced at each city. Because the atmosphere is synthetic,
// the outcome is known for every day of the forecast.

import { coldWaveClass, heatWaveClass, riskMatrix, type WarnLevel } from './imd';
import { sample } from './grid';
import type { City } from './places';
import { ENS_GRID } from './run';
import { makeSynthContext, staticFields, synthesize } from './synth';
import { statesAt, type World } from './world';
import type { HazardType } from './decision';

export interface ObservedHazard {
  type: HazardType;
  value: number;
  level: WarnLevel;
}

export interface ObservedDay {
  day: number;
  level: WarnLevel;
  hazards: ObservedHazard[];
}

/** What actually happened at each city, day by day, from the truth. */
export function observedHazards(world: World, cities: City[], days = 3): Record<string, ObservedDay[]> {
  const g = ENS_GRID;
  const ctx = makeSynthContext(world.season, g, world.seed, world.analysis);
  const st = staticFields(ctx);
  const src = (h: number) => statesAt(world.truth, h);
  const out: Record<string, ObservedDay[]> = {};
  for (const c of cities) out[c.id] = [];
  const rains: Float32Array[] = [];
  for (let t = -18; t <= days * 24; t += 6) {
    const f = synthesize(ctx, t, src);
    rains.push(f.rain6);
    if (rains.length > 4) rains.shift();
    if (t <= 0) continue;
    const day = Math.ceil(t / 24);
    for (const c of cities) {
      const list = out[c.id];
      let d = list[day - 1];
      if (!d) {
        d = { day, level: 0, hazards: [] };
        list[day - 1] = d;
      }
      const wind = Math.hypot(sample(g, f.u10, c.lon, c.lat), sample(g, f.v10, c.lon, c.lat)) * 1.943844;
      bump(d, 'wind', wind, wind >= 64 ? 3 : wind >= 48 ? 2 : wind >= 34 ? 1 : 0);
      if (t % 24 === 0) {
        let r24 = 0;
        for (const r of rains) r24 += sample(g, r, c.lon, c.lat);
        bump(d, 'rain', r24, r24 >= 115.6 ? 3 : r24 >= 64.5 ? 2 : 0);
        const elev = sample(g, st.elev, c.lon, c.lat);
        const coastKm = sample(g, st.coastKm, c.lon, c.lat);
        const tmax = sample(g, f.tmax, c.lon, c.lat);
        const tmin = sample(g, f.tmin, c.lon, c.lat);
        const hw = heatWaveClass(tmax, sample(g, st.tmaxNormal, c.lon, c.lat), elev, c.coastal && coastKm < 40);
        const cw = coldWaveClass(tmin, sample(g, st.tminNormal, c.lon, c.lat), elev);
        bump(d, 'heat', tmax, hw === 2 ? 3 : hw === 1 ? 2 : 0);
        bump(d, 'cold', tmin, cw === 2 ? 3 : cw === 1 ? 2 : 0);
      }
    }
  }
  return out;
}

function bump(d: ObservedDay, type: HazardType, value: number, impact: number) {
  const prev = d.hazards.find((h) => h.type === type);
  const level = impact > 0 ? riskMatrix(3, impact) : 0;
  if (prev) {
    if (type === 'cold' ? value < prev.value : value > prev.value) prev.value = value;
    prev.level = Math.max(prev.level, level) as WarnLevel;
  } else d.hazards.push({ type, value, level: level as WarnLevel });
  d.level = Math.max(d.level, level) as WarnLevel;
}

export interface DrillScore {
  hits: number;
  misses: number;
  falseAlarms: number;
  correctNegatives: number;
  pod: number;
  far: number;
  peirce: number;
  exact: number;
  cells: number;
}

/** Verification of warnings as a yes/no forecast of orange-or-worse conditions. */
export function scoreWarnings(issued: Record<string, WarnLevel[]>, observed: Record<string, ObservedDay[]>, days: number): DrillScore {
  let hits = 0;
  let misses = 0;
  let fa = 0;
  let cn = 0;
  let exact = 0;
  let cells = 0;
  for (const [id, levels] of Object.entries(issued)) {
    const obs = observed[id];
    if (!obs) continue;
    for (let d = 0; d < days; d++) {
      const o = obs[d]?.level ?? 0;
      const f = levels[d] ?? 0;
      cells++;
      if (o === f) exact++;
      const yesF = f >= 2;
      const yesO = o >= 2;
      if (yesF && yesO) hits++;
      else if (!yesF && yesO) misses++;
      else if (yesF && !yesO) fa++;
      else cn++;
    }
  }
  const pod = hits + misses ? hits / (hits + misses) : 1;
  const pofd = fa + cn ? fa / (fa + cn) : 0;
  return {
    hits,
    misses,
    falseAlarms: fa,
    correctNegatives: cn,
    pod,
    far: hits + fa ? fa / (hits + fa) : 0,
    peirce: pod - pofd,
    exact: cells ? exact / cells : 0,
    cells,
  };
}
