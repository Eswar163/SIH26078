// Event detection on gridded model output. Nothing here looks at the synthetic
// systems that generated the fields: each detector works only from the fields,
// exactly as it would on real NWP output.
//
// cyclone  closed-low analysis of smoothed MSLP. A priority flood from each
//          minimum finds the "spill" pressure (the saddle where the basin opens
//          into a neighbouring basin, the domain edge or the 1200 km search
//          radius). Basin depth gives the number of closed 2 hPa isobars; 10 m
//          winds give Vmax, RMW and quadrant 34 kt radii; IMD class from Vmax.
// wd       500 hPa trough analysis: minima of the zonal-anomaly height field
//          north of 27N.
// rain     24 h accumulation >= 64.5 mm (IMD "heavy"), connected clusters with
//          at least a quarter of their area over land.
// heat     IMD heat-wave criteria on the 24 h maximum temperature vs. normal.
// cold     IMD cold-wave criteria on the 24 h minimum temperature vs. normal.
// storm    compact, intense 6 h rain cores away from cyclones (thunderstorms).

import { chaikin, isolines } from './contour';
import { distKm } from './geo';
import { type GridSpec, cellAreaKm2, latAt, lonAt, smooth, vorticity } from './grid';
import { coldWaveClass, cycloneCat, heatWaveClass, rainCat } from './imd';
import type { FieldSet } from './synth';

export type EventKind = 'cyclone' | 'wd' | 'rain' | 'heat' | 'cold' | 'storm';

export interface Detection {
  kind: EventKind;
  t: number;
  lon: number;
  lat: number;
  cat: string;
  score: number;
  overLand: boolean;
  pmin?: number;
  depth?: number;
  closed?: number;
  vmax?: number;
  rmw?: number;
  r34?: number;
  r34q?: [number, number, number, number];
  roci?: number;
  vort?: number;
  rainMax?: number;
  amp?: number;
  area?: number;
  peak?: number;
  mean?: number;
  landFrac?: number;
  severeFrac?: number;
  cells?: Int32Array;
  rings?: number[][];
}

export interface DetectStatics {
  landFrac: Float32Array;
  elev: Float32Array;
  coastKm: Float32Array;
  tmaxNormal: Float32Array;
  tminNormal: Float32Array;
}

// ---------------------------------------------------------------------------
// Binary min-heap keyed by a float array

class MinHeap {
  private idx: Int32Array;
  private n = 0;
  private key: Float32Array;
  constructor(capacity: number, key: Float32Array) {
    this.idx = new Int32Array(capacity);
    this.key = key;
  }
  get size() {
    return this.n;
  }
  clear() {
    this.n = 0;
  }
  push(i: number) {
    if (this.n >= this.idx.length) {
      const bigger = new Int32Array(this.idx.length * 2);
      bigger.set(this.idx);
      this.idx = bigger;
    }
    let c = this.n++;
    this.idx[c] = i;
    const k = this.key[i];
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.key[this.idx[p]] <= k) break;
      this.idx[c] = this.idx[p];
      c = p;
    }
    this.idx[c] = i;
  }
  pop(): number {
    const top = this.idx[0];
    const last = this.idx[--this.n];
    const k = this.key[last];
    let c = 0;
    for (;;) {
      let m = 2 * c + 1;
      if (m >= this.n) break;
      if (m + 1 < this.n && this.key[this.idx[m + 1]] < this.key[this.idx[m]]) m++;
      if (this.key[this.idx[m]] >= k) break;
      this.idx[c] = this.idx[m];
      c = m;
    }
    if (this.n > 0) this.idx[c] = last;
    return top;
  }
}

/** Separable box blur via running sums, `radius` cells, applied twice (close to gaussian). */
function boxBlur2(g: GridSpec, src: Float32Array, radius: number): Float32Array {
  const { nx, ny } = g;
  let a = Float32Array.from(src);
  let b = new Float32Array(a.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < ny; j++) {
      const row = j * nx;
      let sum = 0;
      let cnt = 0;
      for (let i = -radius; i <= radius; i++) {
        if (i >= 0 && i < nx) {
          sum += a[row + i];
          cnt++;
        }
      }
      for (let i = 0; i < nx; i++) {
        b[row + i] = sum / cnt;
        const out = i - radius;
        const inn = i + radius + 1;
        if (out >= 0) {
          sum -= a[row + out];
          cnt--;
        }
        if (inn < nx) {
          sum += a[row + inn];
          cnt++;
        }
      }
    }
    for (let i = 0; i < nx; i++) {
      let sum = 0;
      let cnt = 0;
      for (let j = -radius; j <= radius; j++) {
        if (j >= 0 && j < ny) {
          sum += b[j * nx + i];
          cnt++;
        }
      }
      for (let j = 0; j < ny; j++) {
        a[j * nx + i] = sum / cnt;
        const out = j - radius;
        const inn = j + radius + 1;
        if (out >= 0) {
          sum -= b[out * nx + i];
          cnt--;
        }
        if (inn < ny) {
          sum += b[inn * nx + i];
          cnt++;
        }
      }
    }
    if (pass === 0) {
      const t = a;
      a = t;
      b = new Float32Array(a.length);
    }
  }
  return a;
}

// ---------------------------------------------------------------------------
// Cyclonic systems

const KT = 1.943844;

export function detectCyclones(g: GridSpec, f: FieldSet, st: DetectStatics, wds: Detection[] = []): Detection[] {
  const { nx, ny } = g;
  const n = nx * ny;
  const ps = smooth(g, f.mslp, 2);
  const vort = vorticity(g, f.u10, f.v10);
  // Large-scale flow (about 3 degree box, twice). Subtracting it removes uniform
  // and linearly sheared background flow, such as monsoon westerlies and the
  // trough's cyclonic shear, leaving the vortex's own winds.
  const envRadius = Math.max(2, Math.round(3 / g.d));
  const envU = boxBlur2(g, f.u10, envRadius);
  const envV = boxBlur2(g, f.v10, envRadius);
  const win = Math.max(2, Math.round(1.0 / g.d)); // ~1 degree search window
  const out: Detection[] = [];
  const stamp = new Int32Array(n);
  let stampId = 0;
  const heap = new MinHeap(4096, ps);
  const region: number[] = [];

  for (let j = 3; j < ny - 3; j++) {
    for (let i = 3; i < nx - 3; i++) {
      const k = j * nx + i;
      const p0 = ps[k];
      let isMin = true;
      for (let dj = -win; dj <= win && isMin; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -win; di <= win; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= nx || (di === 0 && dj === 0)) continue;
          const q = ps[jj * nx + ii];
          if (q < p0 || (q === p0 && jj * nx + ii < k)) {
            isMin = false;
            break;
          }
        }
      }
      if (!isMin) continue;
      if (st.elev[k] > 1500) continue;
      const lon = lonAt(g, i);
      const lat = latAt(g, j);

      // Priority flood to the spill (saddle) pressure.
      stampId++;
      heap.clear();
      heap.push(k);
      stamp[k] = stampId;
      region.length = 0;
      let level = p0;
      let spill = Infinity;
      while (heap.size > 0) {
        const x = heap.pop();
        if (ps[x] < level - 1e-4) {
          spill = level;
          break;
        }
        if (ps[x] > level) level = ps[x];
        const xi = x % nx;
        const xj = (x - xi) / nx;
        if (xi === 0 || xj === 0 || xi === nx - 1 || xj === ny - 1 || region.length > 9000) {
          spill = level;
          break;
        }
        if (distKm(lon, lat, lonAt(g, xi), latAt(g, xj)) > 1200) {
          spill = level;
          break;
        }
        region.push(x);
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue;
            const y = x + dj * nx + di;
            if (stamp[y] !== stampId) {
              stamp[y] = stampId;
              heap.push(y);
            }
          }
        }
      }
      if (!Number.isFinite(spill)) spill = level;
      const depth = spill - p0;
      if (depth < 0.8) continue;

      // Mean vorticity within 120 km: cyclonic circulation required.
      let vs = 0;
      let vn = 0;
      const r1 = Math.ceil(1.2 / g.d);
      for (let dj = -r1; dj <= r1; dj++) {
        for (let di = -r1; di <= r1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 1 || jj < 1 || ii >= nx - 1 || jj >= ny - 1) continue;
          if (distKm(lon, lat, lonAt(g, ii), latAt(g, jj)) > 120) continue;
          vs += vort[jj * nx + ii];
          vn++;
        }
      }
      const vmean = vn ? vs / vn : 0;
      if (vmean < 1.8e-5) continue;

      // Skip the surface reflection of a western disturbance; it is reported as the WD.
      if (lat > 28.5 && st.landFrac[k] > 0.5 && wds.some((w) => distKm(w.lon, w.lat, lon, lat) < 900)) continue;

      // Radius of the outermost closed 2 hPa isobar.
      const outer = 2 * Math.ceil(spill / 2) - 2;
      let area = 0;
      for (const x of region) if (ps[x] < outer) area += cellAreaKm2(g, Math.floor(x / nx));
      const roci = Math.sqrt(area / Math.PI);
      const closed = Math.max(0, Math.ceil(spill / 2) - Math.floor(p0 / 2) - 1);

      // Sub-grid centre by parabolic interpolation.
      const px = ps[k - 1] - 2 * p0 + ps[k + 1];
      const py = ps[k - nx] - 2 * p0 + ps[k + nx];
      const ox = px > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (ps[k - 1] - ps[k + 1])) / px)) : 0;
      const oy = py > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (ps[k - nx] - ps[k + nx])) / py)) : 0;
      const clon = lon + ox * g.d;
      const clat = lat + oy * g.d;

      // Wind structure.
      const rSearch = Math.min(800, Math.max(350, roci + 150));
      const rc = Math.ceil(rSearch / 111 / g.d) + 1;
      let vmax = 0;
      let rmw = 0;
      let rainMax = 0;
      const q34: [number, number, number, number] = [0, 0, 0, 0];
      // Azimuthal-mean tangential wind by radius: a uniform background flow cancels out.
      const BIN = 25;
      const nb = Math.ceil(420 / BIN);
      const vtSum = new Float64Array(nb);
      const vtN = new Int32Array(nb);
      for (let dj = -rc; dj <= rc; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -rc; di <= rc; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= nx) continue;
          const y = jj * nx + ii;
          const ylon = lonAt(g, ii);
          const ylat = latAt(g, jj);
          const d = distKm(clon, clat, ylon, ylat);
          if (d > rSearch) continue;
          const du = f.u10[y] - envU[y];
          const dv = f.v10[y] - envV[y];
          const s = Math.hypot(du, dv);
          const sRaw = Math.hypot(f.u10[y], f.v10[y]);
          if (d > 5 && d < nb * BIN) {
            const dx = (ylon - clon) * Math.cos((clat * Math.PI) / 180);
            const dy = ylat - clat;
            const rr = Math.hypot(dx, dy) || 1;
            const b = Math.floor(d / BIN);
            vtSum[b] += (-dy * du + dx * dv) / rr;
            vtN[b]++;
          }
          if (d <= Math.min(450, Math.max(220, roci + 60)) && s > vmax) {
            vmax = s;
            rmw = d;
          }
          if (d <= 300 && f.rain6[y] > rainMax) rainMax = f.rain6[y];
          if (sRaw >= 17.49) {
            const q = ylat >= clat ? (ylon >= clon ? 0 : 3) : ylon >= clon ? 1 : 2;
            if (d > q34[q]) q34[q] = d;
          }
        }
      }
      let vsym = 0;
      let rsym = rmw;
      for (let b = 0; b < nb; b++) {
        if (vtN[b] < 4) continue;
        const m = vtSum[b] / vtN[b];
        if (m > vsym) {
          vsym = m;
          rsym = (b + 0.5) * BIN;
        }
      }
      // Allow asymmetry (motion, background) to add at most a quarter to the symmetric vortex.
      const envAtCentre = Math.hypot(envU[k], envV[k]);
      const vkt = (Math.max(vsym * 1.06, Math.min(vmax, vsym * 1.25)) + 0.3 * envAtCentre) * KT;
      rmw = vsym > 0 ? rsym : rmw;
      const nonzero = q34.filter((x) => x > 0);
      const r34 = nonzero.length ? nonzero.reduce((a, b) => a + b, 0) / 4 : 0;
      const cat = cycloneCat(vkt, closed);
      let pmin = f.mslp[k];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) pmin = Math.min(pmin, f.mslp[k + dj * nx + di]);
      const score = 1 / (1 + Math.exp(-(1.1 * (depth - 1.6) + 6000 * (vmean - 4e-5) + 0.06 * (vkt - 15))));
      out.push({
        kind: 'cyclone',
        t: f.t,
        lon: clon,
        lat: clat,
        cat,
        score,
        overLand: st.landFrac[k] > 0.5,
        pmin,
        depth,
        closed,
        vmax: vkt,
        rmw,
        r34,
        r34q: q34,
        roci,
        vort: vmean,
        rainMax,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Western disturbances (500 hPa troughs)

export function detectWDs(g: GridSpec, f: FieldSet, st: DetectStatics): Detection[] {
  const { nx, ny } = g;
  const anom = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    let s = 0;
    for (let i = 0; i < nx; i++) s += f.z500[j * nx + i];
    const mean = s / nx;
    for (let i = 0; i < nx; i++) anom[j * nx + i] = f.z500[j * nx + i] - mean;
  }
  const a = smooth(g, anom, 3);
  const win = Math.round(3 / g.d);
  const out: Detection[] = [];
  const jStart = Math.ceil((27 - g.lat0) / g.d);
  for (let j = jStart; j < ny - 2; j++) {
    for (let i = 2; i < nx - 2; i++) {
      const k = j * nx + i;
      const v = a[k];
      if (v > -30) continue;
      let isMin = true;
      for (let dj = -win; dj <= win && isMin; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -win; di <= win; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= nx || (di === 0 && dj === 0)) continue;
          const q = a[jj * nx + ii];
          if (q < v || (q === v && jj * nx + ii < k)) {
            isMin = false;
            break;
          }
        }
      }
      if (!isMin) continue;
      const lon = lonAt(g, i);
      const lat = latAt(g, j);
      // Precipitation ahead (east) of the trough.
      let rainMax = 0;
      const rc = Math.round(6 / g.d);
      for (let dj = -rc; dj <= rc; dj++) {
        for (let di = 0; di <= rc; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii >= nx || jj < 0 || jj >= ny) continue;
          rainMax = Math.max(rainMax, f.rain6[jj * nx + ii]);
        }
      }
      const amp = -v;
      const cat = amp >= 85 ? 'Active' : amp >= 50 ? 'Moderate' : 'Feeble';
      if (out.some((o) => distKm(o.lon, o.lat, lon, lat) < 900 && (o.amp ?? 0) >= -v)) continue;
      for (let q = out.length - 1; q >= 0; q--) if (distKm(out[q].lon, out[q].lat, lon, lat) < 900) out.splice(q, 1);
      out.push({
        kind: 'wd',
        t: f.t,
        lon,
        lat,
        cat,
        score: Math.min(1, amp / 100),
        overLand: st.landFrac[k] > 0.5,
        amp,
        rainMax,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Areal events: connected components of a boolean mask

function components(g: GridSpec, mask: Uint8Array, minCells: number): Int32Array[] {
  const { nx, ny } = g;
  const label = new Int32Array(nx * ny);
  const comps: Int32Array[] = [];
  const stack: number[] = [];
  let next = 1;
  for (let k = 0; k < nx * ny; k++) {
    if (!mask[k] || label[k]) continue;
    const cells: number[] = [];
    stack.push(k);
    label[k] = next;
    while (stack.length) {
      const x = stack.pop()!;
      cells.push(x);
      const xi = x % nx;
      const xj = (x - xi) / nx;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = xj + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = xi + di;
          if (ii < 0 || ii >= nx) continue;
          const y = jj * nx + ii;
          if (mask[y] && !label[y]) {
            label[y] = next;
            stack.push(y);
          }
        }
      }
    }
    next++;
    if (cells.length >= minCells) comps.push(Int32Array.from(cells));
  }
  return comps;
}

function outline(g: GridSpec, cells: Int32Array, value: (k: number) => number, level: number): number[][] {
  const { nx } = g;
  let i0 = Infinity;
  let i1 = -Infinity;
  let j0 = Infinity;
  let j1 = -Infinity;
  for (const k of cells) {
    const i = k % nx;
    const j = (k - i) / nx;
    if (i < i0) i0 = i;
    if (i > i1) i1 = i;
    if (j < j0) j0 = j;
    if (j > j1) j1 = j;
  }
  i0 = Math.max(0, i0 - 1);
  j0 = Math.max(0, j0 - 1);
  i1 = Math.min(g.nx - 1, i1 + 1);
  j1 = Math.min(g.ny - 1, j1 + 1);
  const member = new Set<number>(cells);
  const vals = new Float32Array(g.nx * g.ny);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * nx + i;
      vals[k] = member.has(k) ? value(k) : Math.min(value(k), level - 1e-3);
    }
  }
  return isolines(g, vals, level, { i0, j0, i1, j1 })
    .filter((l) => l.length >= 8)
    .map((l) => chaikin(l, 2).map((v) => Math.round(v * 1000) / 1000));
}

function summarise(g: GridSpec, cells: Int32Array, w: (k: number) => number, st: DetectStatics) {
  const { nx } = g;
  let area = 0;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let land = 0;
  for (const k of cells) {
    const i = k % nx;
    const j = (k - i) / nx;
    const a = cellAreaKm2(g, j);
    area += a;
    const wk = Math.max(1e-6, w(k)) * a;
    sw += wk;
    sx += wk * lonAt(g, i);
    sy += wk * latAt(g, j);
    land += st.landFrac[k] * a;
  }
  return { area, lon: sx / sw, lat: sy / sw, landFrac: land / area };
}

export function detectRain(g: GridSpec, rain24: Float32Array, t: number, st: DetectStatics): Detection[] {
  const n = g.nx * g.ny;
  const mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) mask[k] = rain24[k] >= 64.5 ? 1 : 0;
  const minCells = Math.max(3, Math.round(0.5 / (g.d * g.d)));
  const out: Detection[] = [];
  for (const cells of components(g, mask, minCells)) {
    const s = summarise(g, cells, (k) => rain24[k], st);
    if (s.landFrac < 0.25) continue;
    let peak = 0;
    let sum = 0;
    for (const k of cells) {
      peak = Math.max(peak, rain24[k]);
      sum += rain24[k];
    }
    out.push({
      kind: 'rain',
      t,
      lon: s.lon,
      lat: s.lat,
      cat: rainCat(peak) ?? 'heavy',
      score: Math.min(1, peak / 204.5),
      overLand: s.landFrac > 0.5,
      area: s.area,
      peak,
      mean: sum / cells.length,
      landFrac: s.landFrac,
      cells,
      rings: outline(g, cells, (k) => rain24[k], 64.5),
    });
  }
  return out;
}

function thermalEvents(
  g: GridSpec,
  t: number,
  st: DetectStatics,
  kind: 'heat' | 'cold',
  classOf: (k: number) => 0 | 1 | 2,
  value: (k: number) => number,
): Detection[] {
  const n = g.nx * g.ny;
  const cls = new Uint8Array(n);
  const mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (st.landFrac[k] < 0.5 || st.elev[k] > 2000) continue;
    const i = k % g.nx;
    const lon = lonAt(g, i);
    const lat = latAt(g, (k - i) / g.nx);
    // IMD criteria are defined for the subcontinent's plains and hills.
    if (lat < 6 || lat > 34.5 || lon < 66 || lon > 97.5) continue;
    cls[k] = classOf(k);
    mask[k] = cls[k] > 0 ? 1 : 0;
  }
  const minCells = Math.max(4, Math.round(1.5 / (g.d * g.d * 16)));
  const out: Detection[] = [];
  const soft = smooth(g, Float32Array.from(mask), 1);
  for (const cells of components(g, mask, minCells)) {
    let severe = 0;
    let peak = kind === 'heat' ? -Infinity : Infinity;
    let dep = 0;
    for (const k of cells) {
      if (cls[k] === 2) severe++;
      const v = value(k);
      peak = kind === 'heat' ? Math.max(peak, v) : Math.min(peak, v);
      dep += kind === 'heat' ? v - st.tmaxNormal[k] : v - st.tminNormal[k];
    }
    const s = summarise(g, cells, () => 1, st);
    const severeFrac = severe / cells.length;
    const cat = kind === 'heat' ? (severeFrac >= 0.25 ? 'SHW' : 'HW') : severeFrac >= 0.25 ? 'SCW' : 'CW';
    out.push({
      kind,
      t,
      lon: s.lon,
      lat: s.lat,
      cat,
      score: Math.min(1, 0.4 + severeFrac),
      overLand: true,
      area: s.area,
      peak,
      mean: dep / cells.length,
      landFrac: s.landFrac,
      severeFrac,
      cells,
      rings: outline(g, cells, (k) => soft[k], 0.5),
    });
  }
  return out;
}

export function detectHeat(g: GridSpec, f: FieldSet, st: DetectStatics): Detection[] {
  return thermalEvents(
    g,
    f.t,
    st,
    'heat',
    (k) => heatWaveClass(f.tmax[k], st.tmaxNormal[k], st.elev[k], st.coastKm[k] < 40),
    (k) => f.tmax[k],
  );
}

export function detectCold(g: GridSpec, f: FieldSet, st: DetectStatics): Detection[] {
  return thermalEvents(g, f.t, st, 'cold', (k) => coldWaveClass(f.tmin[k], st.tminNormal[k], st.elev[k]), (k) => f.tmin[k]);
}

export function detectStorms(g: GridSpec, f: FieldSet, st: DetectStatics, cyclones: Detection[]): Detection[] {
  const n = g.nx * g.ny;
  const mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) mask[k] = f.rain6[k] >= 22 ? 1 : 0;
  const maxCells = Math.round(60 * (0.25 / g.d) ** 2);
  const out: Detection[] = [];
  for (const cells of components(g, mask, 2)) {
    if (cells.length > maxCells) continue;
    let peak = 0;
    for (const k of cells) peak = Math.max(peak, f.rain6[k]);
    if (peak < 36) continue;
    const s = summarise(g, cells, (k) => f.rain6[k], st);
    if (s.landFrac < 0.5) continue;
    if (cyclones.some((c) => (c.vmax ?? 0) >= 17 && distKm(c.lon, c.lat, s.lon, s.lat) < 500)) continue;
    out.push({
      kind: 'storm',
      t: f.t,
      lon: s.lon,
      lat: s.lat,
      cat: peak >= 48 ? 'STS' : 'TS',
      score: Math.min(1, peak / 70),
      overLand: s.landFrac > 0.5,
      area: s.area,
      peak,
      landFrac: s.landFrac,
      cells,
      rings: outline(g, cells, (k) => f.rain6[k], 22),
    });
  }
  return out.sort((a, b) => (b.peak ?? 0) - (a.peak ?? 0)).slice(0, 5);
}
