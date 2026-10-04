import { describe, expect, it } from 'vitest';
import { observedHazards, scoreWarnings } from '../src/engine/drill';
import { makeWorld } from '../src/engine/world';
import { CITY_BY_ID } from '../src/engine/places';

describe('warning drill', () => {
  it('replays the truth at cities: the landfall city gets severe weather', () => {
    const w = makeWorld('postmonsoon', 20261004, Date.UTC(2026, 9, 4));
    const cities = ['puducherry', 'chennai', 'delhi'].map((id) => CITY_BY_ID.get(id)!);
    const obs = observedHazards(w, cities, 3);
    const pud = obs.puducherry.map((d) => d.level);
    expect(Math.max(...pud)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...obs.delhi.map((d) => d.level))).toBe(0);
  });
  it('scores warnings as a yes/no forecast of orange or worse', () => {
    const observed = {
      a: [{ day: 1, level: 3 as const, hazards: [] }, { day: 2, level: 0 as const, hazards: [] }],
      b: [{ day: 1, level: 0 as const, hazards: [] }, { day: 2, level: 2 as const, hazards: [] }],
    };
    const perfect = scoreWarnings({ a: [3, 0], b: [0, 2] }, observed, 2);
    expect(perfect.peirce).toBe(1);
    expect(perfect.exact).toBe(1);
    const lazy = scoreWarnings({ a: [0, 0], b: [0, 0] }, observed, 2);
    expect(lazy.misses).toBe(2);
    expect(lazy.peirce).toBe(0);
  });
});
