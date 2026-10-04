import { describe, expect, it } from 'vitest';
import { makeGrid } from '../src/engine/grid';
import { makeSynthContext, staticFields, synthesize, type FieldSet } from '../src/engine/synth';
import { detectCyclones, detectHeat, detectRain, detectWDs, type Detection } from '../src/engine/detect';
import { trackAreal, trackVortices } from '../src/engine/track';
import { distKm } from '../src/engine/geo';
import type { SysState } from '../src/engine/world';

const g = makeGrid(0.25);

function vortex(id: number, lon: number, lat: number, v: number, kind: SysState['kind'] = 'tc'): SysState {
  return { id, kind, lon, lat, v, rmax: kind === 'tc' ? 40 : 170, roci: 600, cu: -3, cv: 1, land: 0, b: kind === 'tc' ? 1.15 + 0.0065 * v : 1, rainEff: 1, age: 24 };
}

function fieldsWith(systems: (t: number) => SysState[], t = 6, season: 'postmonsoon' | 'premonsoon' = 'postmonsoon'): { f: FieldSet; ctx: ReturnType<typeof makeSynthContext> } {
  const ctx = makeSynthContext(season, g, 99, Date.UTC(2026, 9, 4));
  return { f: synthesize(ctx, t, systems), ctx };
}

describe('cyclone detection', () => {
  it('finds a synthetic cyclone at the right place and strength', () => {
    const { f, ctx } = fieldsWith(() => [vortex(1, 86, 13, 80)]);
    const dets = detectCyclones(g, f, staticFields(ctx));
    const near = dets.filter((d) => distKm(d.lon, d.lat, 86, 13) < 60);
    expect(near.length).toBe(1);
    const d = near[0];
    expect(d.vmax!).toBeGreaterThan(64);
    expect(d.vmax!).toBeLessThan(110);
    expect(['VSCS', 'ESCS']).toContain(d.cat);
    expect(d.closed!).toBeGreaterThanOrEqual(8);
    expect(d.pmin!).toBeLessThan(990);
  });
  it('separates two cyclones and ignores a calm sea', () => {
    const { f, ctx } = fieldsWith(() => [vortex(1, 86, 12, 60), vortex(2, 68, 15, 45)]);
    const dets = detectCyclones(g, f, staticFields(ctx)).filter((d) => (d.vmax ?? 0) >= 34);
    expect(dets.length).toBe(2);
    const { f: calm, ctx: c2 } = fieldsWith(() => []);
    expect(detectCyclones(g, calm, staticFields(c2)).filter((d) => (d.vmax ?? 0) >= 17).length).toBe(0);
  });
  it('does not mistake monsoon-style background shear for storm wind', () => {
    const { f, ctx } = fieldsWith(() => [vortex(1, 86, 19, 22, 'mlow')]);
    const d = detectCyclones(g, f, staticFields(ctx)).find((x) => distKm(x.lon, x.lat, 86, 19) < 150);
    expect(d).toBeTruthy();
    expect(d!.vmax!).toBeLessThan(34);
  });
});

describe('other detectors', () => {
  it('detects a western disturbance trough', () => {
    const wd: SysState = { id: 5, kind: 'wd', lon: 70, lat: 33, v: 110, rmax: 520, roci: 1400, cu: 9, cv: 0, land: 1, b: 1, rainEff: 1, age: 50 };
    const { f, ctx } = fieldsWith(() => [wd]);
    const w = detectWDs(g, f, staticFields(ctx));
    expect(w.length).toBeGreaterThanOrEqual(1);
    expect(distKm(w[0].lon, w[0].lat, 70, 33)).toBeLessThan(400);
    expect(w[0].cat).toBe('Active');
  });
  it('detects a heat wave over Rajasthan in the pre-monsoon', () => {
    const heat: SysState = { id: 7, kind: 'heat', lon: 74, lat: 26.5, v: 6.5, rmax: 520, roci: 900, cu: 0, cv: 0, land: 1, b: 1, rainEff: 1, age: 80 };
    const { f, ctx } = fieldsWith(() => [heat], 12, 'premonsoon');
    const h = detectHeat(g, f, staticFields(ctx));
    expect(h.length).toBeGreaterThanOrEqual(1);
    expect(h[0].peak!).toBeGreaterThan(43);
  });
  it('outlines a heavy-rain cluster under a landfalling cyclone', () => {
    const { f, ctx } = fieldsWith(() => [vortex(1, 80.2, 13, 70)]);
    const r24 = Float32Array.from(f.rain6, (x) => x * 4);
    const rain = detectRain(g, r24, 6, staticFields(ctx));
    expect(rain.length).toBeGreaterThanOrEqual(1);
    expect(rain[0].rings!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('tracking', () => {
  const det = (lon: number, lat: number, t: number, v = 40): Detection => ({ kind: 'cyclone', t, lon, lat, cat: v >= 34 ? 'CS' : 'D', score: 1, overLand: false, vmax: v, pmin: 990 });
  it('links a moving vortex into one track and bridges a missed step', () => {
    const steps = [0, 6, 12, 18, 24].map((t, i) => (i === 2 ? [] : [det(90 - i * 0.6, 10 + i * 0.3, t)]));
    const tr = trackVortices('cyclone', steps, [0, 6, 12, 18, 24]);
    expect(tr.length).toBe(1);
    expect(tr[0].points.length).toBe(5);
    expect(tr[0].points[2].interpolated).toBe(true);
  });
  it('keeps two nearby systems apart', () => {
    const times = [0, 6, 12, 18];
    const steps = times.map((t, i) => [det(85 - i * 0.5, 12, t), det(85 - i * 0.5, 15.5, t, 25)]);
    const tr = trackVortices('cyclone', steps, times);
    expect(tr.length).toBe(2);
    for (const x of tr) expect(new Set(x.points.map((p) => Math.round(p.lat))).size).toBe(1);
  });
  it('records splits and merges of areal events', () => {
    const cells = (from: number, to: number) => Int32Array.from({ length: to - from }, (_, i) => from + i);
    const area = (t: number, c: Int32Array, lon: number): Detection => ({ kind: 'rain', t, lon, lat: 20, cat: 'heavy', score: 1, overLand: true, cells: c, area: c.length * 700 });
    const steps = [[area(0, cells(1000, 1040), 80)], [area(6, cells(1000, 1022), 79.5), area(6, cells(1020, 1040), 80.5)]];
    const rel: { from: string; to: string; type: string; t: number }[] = [];
    const tr = trackAreal('rain', steps, [0, 6], rel as never);
    expect(tr.length).toBe(2);
    expect(rel.some((r) => r.type === 'split')).toBe(true);
  });
});
