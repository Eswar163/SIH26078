import { describe, expect, it } from 'vitest';
import { makeNoise3, makeRng, mixSeed } from '../src/engine/rng';
import { bearingDeg, destination, distKm, nearestOnPolyline } from '../src/engine/geo';
import { isolines } from '../src/engine/contour';
import { assign } from '../src/engine/hungarian';
import { makeGrid, sample, smooth } from '../src/engine/grid';
import { landInfo, isLandPoint } from '../src/engine/land';
import { cycloneCat, heatWaveClass, coldWaveClass, riskMatrix, rainCat } from '../src/engine/imd';
import { seaArea, coastPosition, relativeTo, CITY_BY_ID } from '../src/engine/places';

describe('rng', () => {
  it('is deterministic per seed and label', () => {
    const a = makeRng(42, 'x');
    const b = makeRng(42, 'x');
    const c = makeRng(42, 'y');
    const sa = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(sa);
    expect(mixSeed(1, 'a')).toBe(mixSeed(1, 'a'));
  });
  it('produces sensible normal draws', () => {
    const r = makeRng('normal');
    const xs = Array.from({ length: 20000 }, () => r.normal());
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(sd - 1)).toBeLessThan(0.03);
  });
  it('simplex noise stays bounded and is smooth', () => {
    const n = makeNoise3(7);
    let max = 0;
    for (let i = 0; i < 5000; i++) max = Math.max(max, Math.abs(n(i * 0.137, i * 0.071, i * 0.013)));
    expect(max).toBeLessThanOrEqual(1.05);
    expect(Math.abs(n(1, 2, 3) - n(1.001, 2, 3))).toBeLessThan(0.02);
  });
});

describe('geo', () => {
  it('haversine distance and destination round-trip', () => {
    const d = distKm(80.27, 13.08, 83.22, 17.69);
    expect(d).toBeGreaterThan(590);
    expect(d).toBeLessThan(630);
    const b = bearingDeg(80, 13, 83, 17);
    const [lon, lat] = destination(80, 13, b, distKm(80, 13, 83, 17));
    expect(Math.abs(lon - 83)).toBeLessThan(0.01);
    expect(Math.abs(lat - 17)).toBeLessThan(0.01);
  });
  it('finds the nearest point on a polyline', () => {
    const r = nearestOnPolyline(80.5, 13, [
      [80, 12],
      [80, 14],
    ]);
    expect(r.dist).toBeGreaterThan(50);
    expect(r.dist).toBeLessThan(60);
    expect(r.arcKm).toBeGreaterThan(100);
  });
});

describe('grid and land', () => {
  const g = makeGrid(0.5);
  it('bilinear sampling interpolates exactly on a plane', () => {
    const f = new Float32Array(g.nx * g.ny);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) f[j * g.nx + i] = 2 * (g.lon0 + i * g.d) + 3 * (g.lat0 + j * g.d);
    expect(sample(g, f, 77.3, 21.7)).toBeCloseTo(2 * 77.3 + 3 * 21.7, 3);
  });
  it('smoothing preserves a constant field', () => {
    const f = new Float32Array(g.nx * g.ny).fill(1010);
    const s = smooth(g, f, 3);
    expect(s[500]).toBeCloseTo(1010, 4);
  });
  it('knows India is land and the Bay is sea', () => {
    expect(isLandPoint(78.5, 22)).toBe(true);
    expect(isLandPoint(88, 15)).toBe(false);
    const info = landInfo(g);
    const k = Math.round((22 - g.lat0) / g.d) * g.nx + Math.round((78.5 - g.lon0) / g.d);
    expect(info.mask[k]).toBe(1);
    expect(info.coastKm[k]).toBeGreaterThan(300);
  });
});

describe('contours', () => {
  it('draws a closed ring around a radial bump', () => {
    const g = makeGrid(0.25);
    const f = new Float32Array(g.nx * g.ny);
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const dx = g.lon0 + i * g.d - 75;
        const dy = g.lat0 + j * g.d - 20;
        f[j * g.nx + i] = Math.exp(-(dx * dx + dy * dy) / 8);
      }
    const lines = isolines(g, f, 0.5);
    expect(lines.length).toBe(1);
    const ring = lines[0];
    expect(ring[0]).toBeCloseTo(ring[ring.length - 2], 6);
    expect(ring[1]).toBeCloseTo(ring[ring.length - 1], 6);
    // Radius where exp(-r^2/8) = 0.5 is sqrt(8 ln 2) = 2.355 degrees.
    for (let i = 0; i < ring.length; i += 2) expect(Math.hypot(ring[i] - 75, ring[i + 1] - 20)).toBeCloseTo(2.355, 1);
  });
});

describe('hungarian assignment', () => {
  it('matches brute force on random matrices', () => {
    const r = makeRng('hung');
    for (let trial = 0; trial < 40; trial++) {
      const n = 1 + Math.floor(r.next() * 4);
      const m = 1 + Math.floor(r.next() * 4);
      const cost = Array.from({ length: n }, () => Array.from({ length: m }, () => r.next()));
      const got = assign(cost, 2);
      const total = (a: number[]) => a.reduce((s, j, i) => s + (j < 0 ? 2 : cost[i][j]), 0);
      let best = Infinity;
      const perm = (i: number, used: Set<number>, acc: number[]) => {
        if (i === n) {
          best = Math.min(best, total(acc));
          return;
        }
        perm(i + 1, used, [...acc, -1]);
        for (let j = 0; j < m; j++) if (!used.has(j)) perm(i + 1, new Set([...used, j]), [...acc, j]);
      };
      perm(0, new Set(), []);
      expect(total(got)).toBeCloseTo(best, 9);
    }
  });
  it('leaves rows unassigned when every option is too costly', () => {
    expect(assign([[5, 6]], 1)).toEqual([-1]);
    expect(assign([[0.2, 1e6]], 1)).toEqual([0]);
  });
});

describe('IMD scales and places', () => {
  it('classifies cyclonic disturbances by wind', () => {
    expect(cycloneCat(10, 1)).toBe('L');
    expect(cycloneCat(10, 2)).toBe('WML');
    expect(cycloneCat(20)).toBe('D');
    expect(cycloneCat(30)).toBe('DD');
    expect(cycloneCat(40)).toBe('CS');
    expect(cycloneCat(55)).toBe('SCS');
    expect(cycloneCat(70)).toBe('VSCS');
    expect(cycloneCat(100)).toBe('ESCS');
    expect(cycloneCat(130)).toBe('SuCS');
  });
  it('applies heat and cold wave criteria', () => {
    expect(heatWaveClass(44, 39, 200, false)).toBe(1);
    expect(heatWaveClass(46, 39, 200, false)).toBe(2);
    expect(heatWaveClass(39, 33, 200, false)).toBe(0);
    expect(coldWaveClass(1, 6, 200)).toBe(2);
    expect(coldWaveClass(8, 9, 200)).toBe(0);
    expect(rainCat(70)).toBe('heavy');
    expect(rainCat(210)).toBe('extremely heavy');
  });
  it('uses the impact-based warning matrix', () => {
    expect(riskMatrix(3, 3)).toBe(3);
    expect(riskMatrix(0, 3)).toBe(1);
    expect(riskMatrix(3, 0)).toBe(0);
  });
  it('describes positions like a bulletin', () => {
    expect(seaArea(84, 11)).toBe('the southwest Bay of Bengal');
    expect(seaArea(70, 16)).toBe('the eastcentral Arabian Sea');
    const chennai = CITY_BY_ID.get('chennai')!;
    expect(relativeTo(82, 11.5, chennai)).toMatch(/km south-?east|km east-southeast|km southeast/);
    expect(coastPosition(80.3, 13.1).nearest.region).toBe('Tamil Nadu');
  });
});
