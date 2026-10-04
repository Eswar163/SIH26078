// Marching squares. Produces isolines as polylines in lon/lat, joined across
// cells so that labels can be placed along them and closed rings stay closed.

import type { GridSpec } from './grid';

/** Isolines of `values` at `level`. Each line is a flat [lon0, lat0, lon1, lat1, ...] array. */
export function isolines(g: GridSpec, values: ArrayLike<number>, level: number, region?: { i0: number; j0: number; i1: number; j1: number }): number[][] {
  const i0 = region?.i0 ?? 0;
  const j0 = region?.j0 ?? 0;
  const i1 = region?.i1 ?? g.nx - 1;
  const j1 = region?.j1 ?? g.ny - 1;
  const { nx } = g;
  // Segment endpoints are identified by the grid edge they lie on, so joining is exact.
  // Edge id: horizontal edge (i,j)-(i+1,j) => 2*(j*nx+i); vertical edge (i,j)-(i,j+1) => 2*(j*nx+i)+1
  const segA: number[] = [];
  const segB: number[] = [];
  const point = new Map<number, [number, number]>();

  const edgePoint = (id: number): [number, number] => {
    const hit = point.get(id);
    if (hit) return hit;
    const cell = id >> 1;
    const i = cell % nx;
    const j = (cell - i) / nx;
    const a = values[cell];
    let p: [number, number];
    if ((id & 1) === 0) {
      const b = values[cell + 1];
      const f = b === a ? 0.5 : (level - a) / (b - a);
      p = [g.lon0 + (i + f) * g.d, g.lat0 + j * g.d];
    } else {
      const b = values[cell + nx];
      const f = b === a ? 0.5 : (level - a) / (b - a);
      p = [g.lon0 + i * g.d, g.lat0 + (j + f) * g.d];
    }
    point.set(id, p);
    return p;
  };

  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const k = j * nx + i;
      const v0 = values[k]; // bottom-left
      const v1 = values[k + 1]; // bottom-right
      const v2 = values[k + nx + 1]; // top-right
      const v3 = values[k + nx]; // top-left
      let code = 0;
      if (v0 >= level) code |= 1;
      if (v1 >= level) code |= 2;
      if (v2 >= level) code |= 4;
      if (v3 >= level) code |= 8;
      if (code === 0 || code === 15) continue;
      const bottom = 2 * k;
      const top = 2 * (k + nx);
      const left = 2 * k + 1;
      const right = 2 * (k + 1) + 1;
      const push = (a: number, b: number) => {
        segA.push(a);
        segB.push(b);
      };
      switch (code) {
        case 1: case 14: push(left, bottom); break;
        case 2: case 13: push(bottom, right); break;
        case 3: case 12: push(left, right); break;
        case 4: case 11: push(right, top); break;
        case 6: case 9: push(bottom, top); break;
        case 7: case 8: push(left, top); break;
        case 5: case 10: {
          const centre = (v0 + v1 + v2 + v3) / 4;
          const high = centre >= level;
          if ((code === 5) === high) {
            push(left, top);
            push(bottom, right);
          } else {
            push(left, bottom);
            push(right, top);
          }
          break;
        }
      }
    }
  }

  // Join segments into polylines.
  const adj = new Map<number, number[]>();
  for (let s = 0; s < segA.length; s++) {
    for (const e of [segA[s], segB[s]]) {
      const list = adj.get(e);
      if (list) list.push(s);
      else adj.set(e, [s]);
    }
  }
  const used = new Uint8Array(segA.length);
  const lines: number[][] = [];
  const other = (s: number, e: number) => (segA[s] === e ? segB[s] : segA[s]);
  const nextSeg = (e: number) => {
    const list = adj.get(e);
    if (!list) return -1;
    for (const s of list) if (!used[s]) return s;
    return -1;
  };
  for (let s0 = 0; s0 < segA.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const forward: number[] = [segA[s0], segB[s0]];
    let e = segB[s0];
    for (;;) {
      const s = nextSeg(e);
      if (s < 0) break;
      used[s] = 1;
      e = other(s, e);
      forward.push(e);
    }
    const backward: number[] = [];
    e = segA[s0];
    for (;;) {
      const s = nextSeg(e);
      if (s < 0) break;
      used[s] = 1;
      e = other(s, e);
      backward.push(e);
    }
    const ids = [...backward.reverse(), ...forward];
    const flat: number[] = [];
    for (const id of ids) {
      const p = edgePoint(id);
      flat.push(p[0], p[1]);
    }
    lines.push(flat);
  }
  return lines;
}

/** Chaikin corner cutting for smoother outlines; keeps rings closed. */
export function chaikin(line: number[], iterations = 2): number[] {
  let pts = line;
  for (let it = 0; it < iterations; it++) {
    const n = pts.length / 2;
    if (n < 3) return pts;
    const closed = pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1];
    const out: number[] = [];
    if (!closed) out.push(pts[0], pts[1]);
    for (let i = 0; i < n - 1; i++) {
      const ax = pts[2 * i];
      const ay = pts[2 * i + 1];
      const bx = pts[2 * i + 2];
      const by = pts[2 * i + 3];
      out.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
    }
    if (closed) out.push(out[0], out[1]);
    else out.push(pts[pts.length - 2], pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

export function lineLength(line: number[]): number {
  let s = 0;
  for (let i = 2; i < line.length; i += 2) {
    const dx = (line[i] - line[i - 2]) * Math.cos((line[i + 1] * Math.PI) / 180);
    const dy = line[i + 1] - line[i - 1];
    s += Math.sqrt(dx * dx + dy * dy);
  }
  return s;
}
