// Canvas drawing for the synoptic chart. All geometry is projected to screen
// pixels at draw time, so line widths stay crisp at every zoom level.

import { isolines, lineLength, chaikin } from '../engine/contour';
import type { Cone } from '../engine/cone';
import type { CityOutlook } from '../engine/decision';
import type { EventTrack } from '../engine/events';
import type { GridSpec } from '../engine/grid';
import { latAt, lonAt, smooth } from '../engine/grid';
import { catIndex } from '../engine/imd';
import { LAND_RINGS } from '../engine/land';
import { CITIES } from '../engine/places';
import type { TrackPoint } from '../engine/track';
import { lut, type Ramp } from './palettes';
import { project, type MapViewState } from './view';

export interface Theme {
  paper: string;
  sea: string;
  land: string;
  landEdge: string;
  ink: string;
  ink2: string;
  graphite: string;
  fog: string;
  rule: string;
  track: string;
  track2: string;
  trackWash: string;
  trackLine: string;
  halo: string;
  heat: string;
  cold: string;
  rain: string;
  warn: [string, string, string, string];
  font: string;
  dark: boolean;
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    paper: v('--paper'),
    sea: v('--sea'),
    land: v('--land'),
    landEdge: v('--land-edge'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    graphite: v('--graphite'),
    fog: v('--fog'),
    rule: v('--rule'),
    track: v('--track'),
    track2: v('--track-2'),
    trackWash: v('--track-wash'),
    trackLine: v('--track-line'),
    halo: v('--halo'),
    heat: v('--heat'),
    cold: v('--cold'),
    rain: v('--rain'),
    warn: [v('--imd-green'), v('--imd-yellow'), v('--imd-orange'), v('--imd-red')],
    font: v('--font') || 'system-ui',
    dark: cs.colorScheme === 'dark' || document.documentElement.dataset.theme === 'dark',
  };
}

export interface Frame {
  ctx: CanvasRenderingContext2D;
  view: MapViewState;
  w: number;
  h: number;
  theme: Theme;
}

const P = (f: Frame, lon: number, lat: number) => project(f.view, f.w, f.h, lon, lat);

export function font(f: Frame, size: number, weight = 500, stretch = 92): string {
  return `${weight} ${stretch}% ${size}px ${f.theme.font}`;
}

// ---------------------------------------------------------------- base

function landPath(f: Frame): Path2D {
  const path = new Path2D();
  for (const ring of LAND_RINGS) {
    for (let i = 0; i < ring.length; i += 2) {
      const [x, y] = P(f, ring[i], ring[i + 1]);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
  }
  return path;
}

export function drawSeaAndLand(f: Frame): Path2D {
  const { ctx, theme } = f;
  ctx.fillStyle = theme.sea;
  ctx.fillRect(0, 0, f.w, f.h);
  const land = landPath(f);
  ctx.fillStyle = theme.land;
  ctx.fill(land, 'evenodd');
  return land;
}

export function drawCoast(f: Frame, land: Path2D) {
  const { ctx, theme } = f;
  ctx.save();
  ctx.strokeStyle = theme.dark ? 'rgba(200,215,220,0.45)' : 'rgba(21,35,43,0.55)';
  ctx.lineWidth = 0.8;
  ctx.lineJoin = 'round';
  ctx.stroke(land);
  ctx.restore();
}

export function drawGraticule(f: Frame) {
  const { ctx, theme } = f;
  ctx.save();
  ctx.strokeStyle = theme.dark ? 'rgba(140,160,168,0.14)' : 'rgba(21,35,43,0.09)';
  ctx.lineWidth = 0.6;
  ctx.font = font(f, 10, 500, 88);
  ctx.fillStyle = theme.fog;
  const step = f.view.k > 40 ? 2 : 5;
  for (let lon = 40; lon <= 110; lon += step) {
    const [x] = P(f, lon, 0);
    if (x < -10 || x > f.w + 10) continue;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, f.h);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${lon}°E`, x, 4);
  }
  for (let lat = -10; lat <= 50; lat += step) {
    const [, y] = P(f, 0, lat);
    if (y < -10 || y > f.h + 10) continue;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(f.w, y + 0.5);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${lat}°N`, 4, y - 6);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- raster

const rasterCache = new WeakMap<ArrayLike<number>, Map<string, HTMLCanvasElement>>();

export function rasterCanvas(g: GridSpec, data: ArrayLike<number>, r: Ramp, scale = 1, mask?: Uint8Array | Float32Array, maskMode?: 'land' | 'sea'): HTMLCanvasElement {
  const key = `${r.id}:${scale}:${maskMode ?? ''}`;
  let m = rasterCache.get(data);
  if (!m) {
    m = new Map();
    rasterCache.set(data, m);
  }
  const hit = m.get(key);
  if (hit) return hit;
  // Upsample 3x by bilinear interpolation of the data itself, so colour
  // boundaries follow smooth contours instead of grid cells.
  const up = g.nx * g.ny > 20000 ? 3 : 4;
  const W = (g.nx - 1) * up + 1;
  const H = (g.ny - 1) * up + 1;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const table = lut(r);
  const floor = r.floor;
  const soft = floor !== undefined ? Math.max(1e-6, floor * 0.6) : 0;
  for (let y = 0; y < H; y++) {
    const gy = (H - 1 - y) / up;
    const j = Math.min(g.ny - 2, Math.floor(gy));
    const fy = gy - j;
    for (let x = 0; x < W; x++) {
      const gx = x / up;
      const i = Math.min(g.nx - 2, Math.floor(gx));
      const fx = gx - i;
      const k = j * g.nx + i;
      const o = (y * W + x) * 4;
      if (mask && maskMode) {
        const lf = mask[k] * (1 - fx) * (1 - fy) + mask[k + 1] * fx * (1 - fy) + mask[k + g.nx] * (1 - fx) * fy + mask[k + g.nx + 1] * fx * fy;
        if ((maskMode === 'sea' && lf > 0.5) || (maskMode === 'land' && lf < 0.5)) {
          img.data[o + 3] = 0;
          continue;
        }
      }
      const a = data[k];
      const b = data[k + 1];
      const cc = data[k + g.nx];
      const d = data[k + g.nx + 1];
      let v = (a + (b - a) * fx + (cc - a) * fy + (a - b - cc + d) * fx * fy) * scale;
      let fade = 1;
      if (floor !== undefined) {
        if (v < floor - soft) {
          img.data[o + 3] = 0;
          continue;
        }
        if (v < floor) fade = (v - (floor - soft)) / soft;
      }
      v = Math.max(r.min, Math.min(r.max, v));
      const idx = Math.round(((v - r.min) / (r.max - r.min)) * 255) * 4;
      img.data[o] = table[idx];
      img.data[o + 1] = table[idx + 1];
      img.data[o + 2] = table[idx + 2];
      img.data[o + 3] = table[idx + 3] * fade;
    }
  }
  ctx.putImageData(img, 0, 0);
  m.set(key, c);
  return c;
}

export function drawRaster(f: Frame, g: GridSpec, canvas: HTMLCanvasElement, alpha = 1) {
  const { ctx } = f;
  // The upsampled image spans grid point to grid point.
  const [x0, y0] = P(f, g.lon0, g.lat0 + (g.ny - 1) * g.d);
  const [x1, y1] = P(f, g.lon0 + (g.nx - 1) * g.d, g.lat0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

// ---------------------------------------------------------------- isolines

interface IsoSet {
  levels: { level: number; lines: number[][] }[];
}
const isoCache = new WeakMap<ArrayLike<number>, Map<string, IsoSet>>();

export function isoSet(g: GridSpec, data: Float32Array, interval: number, smoothPasses: number, key: string): IsoSet {
  let m = isoCache.get(data);
  if (!m) {
    m = new Map();
    isoCache.set(data, m);
  }
  const hit = m.get(key);
  if (hit) return hit;
  const s = smoothPasses ? smooth(g, data, smoothPasses) : data;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < s.length; k++) {
    if (s[k] < lo) lo = s[k];
    if (s[k] > hi) hi = s[k];
  }
  const levels: IsoSet['levels'] = [];
  for (let v = Math.ceil(lo / interval) * interval; v <= hi; v += interval) {
    const lines = isolines(g, s, v).filter((l) => l.length >= 8).map((l) => chaikin(l, 1));
    if (lines.length) levels.push({ level: v, lines });
  }
  const out = { levels };
  m.set(key, out);
  return out;
}

export function drawIsolines(
  f: Frame,
  set: IsoSet,
  opts: { color: string; width: number; boldEvery?: number; label: (v: number) => string; labelEvery?: number; dash?: number[] },
) {
  const { ctx, theme } = f;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const labels: { x: number; y: number; a: number; text: string }[] = [];
  const spacing = opts.labelEvery ?? 260;
  for (const { level, lines } of set.levels) {
    const bold = opts.boldEvery ? Math.round(level) % opts.boldEvery === 0 : false;
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = bold ? opts.width * 1.6 : opts.width;
    ctx.setLineDash(opts.dash ?? []);
    for (const line of lines) {
      ctx.beginPath();
      let px = 0;
      let py = 0;
      let acc = spacing * 0.45;
      let any = false;
      for (let i = 0; i < line.length; i += 2) {
        const [x, y] = P(f, line[i], line[i + 1]);
        if (i === 0) ctx.moveTo(x, y);
        else {
          ctx.lineTo(x, y);
          const d = Math.hypot(x - px, y - py);
          acc += d;
          if (acc > spacing && x > 30 && x < f.w - 30 && y > 20 && y < f.h - 20) {
            labels.push({ x, y, a: Math.atan2(y - py, x - px), text: opts.label(level) });
            acc = 0;
          }
          if (x > -50 && x < f.w + 50 && y > -50 && y < f.h + 50) any = true;
        }
        px = x;
        py = y;
      }
      if (any || line.length < 40) ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.font = font(f, 10, 600, 88);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of labels) {
    let a = l.a;
    if (a > Math.PI / 2) a -= Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(a);
    const w = ctx.measureText(l.text).width + 6;
    ctx.fillStyle = theme.halo;
    ctx.fillRect(-w / 2, -6, w, 12);
    ctx.fillStyle = opts.color;
    ctx.fillText(l.text, 0, 0.5);
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- wind barbs

export function drawBarbs(f: Frame, g: GridSpec, u: Float32Array, v: Float32Array, sampleFn: (arr: Float32Array, lon: number, lat: number) => number, unprojectFn: (x: number, y: number) => [number, number]) {
  const { ctx, theme } = f;
  const spacing = 40;
  ctx.save();
  ctx.strokeStyle = theme.dark ? 'rgba(220,230,233,0.75)' : 'rgba(21,35,43,0.7)';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 1;
  for (let y = spacing / 2; y < f.h; y += spacing) {
    for (let x = spacing / 2; x < f.w; x += spacing) {
      const [lon, lat] = unprojectFn(x, y);
      if (lon < g.lon0 || lat < g.lat0 || lon > lonAt(g, g.nx - 1) || lat > latAt(g, g.ny - 1)) continue;
      const uu = sampleFn(u, lon, lat);
      const vv = sampleFn(v, lon, lat);
      barb(ctx, x, y, uu, vv);
    }
  }
  ctx.restore();
}

/** WMO wind barb. The staff points into the wind; flags sit on the clockwise side. */
function barb(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, v: number) {
  const kt = Math.hypot(u, v) * 1.943844;
  if (kt < 3) {
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  // Direction the wind blows from, in screen space.
  const fx = -u;
  const fy = v;
  const len = Math.hypot(fx, fy) || 1;
  const dx = fx / len;
  const dy = fy / len;
  const L = 15;
  const tipX = x + dx * L;
  const tipY = y + dy * L;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  // Perpendicular, clockwise of the staff.
  const px = -dy;
  const py = dx;
  let remaining = Math.round(kt / 5) * 5;
  let pos = 0;
  const flag = 7;
  while (remaining >= 50) {
    const bx = tipX - dx * pos;
    const by = tipY - dy * pos;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + px * flag, by + py * flag);
    ctx.lineTo(bx - dx * 4, by - dy * 4);
    ctx.closePath();
    ctx.fill();
    pos += 5;
    remaining -= 50;
  }
  while (remaining >= 10) {
    const bx = tipX - dx * pos;
    const by = tipY - dy * pos;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + px * flag + dx * 2.5, by + py * flag + dy * 2.5);
    ctx.stroke();
    pos += 3;
    remaining -= 10;
  }
  if (remaining >= 5) {
    if (pos === 0) pos = 3;
    const bx = tipX - dx * pos;
    const by = tipY - dy * pos;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + px * flag * 0.5 + dx * 1.2, by + py * flag * 0.5 + dy * 1.2);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- symbols

export function drawCycloneSymbol(ctx: CanvasRenderingContext2D, x: number, y: number, cat: string, color: string, scale = 1) {
  const ci = catIndex(cat);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  if (ci <= 1) {
    // Low: an "L" in drafting style.
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(x - 4 * scale, y - 6 * scale);
    ctx.lineTo(x - 4 * scale, y + 6 * scale);
    ctx.lineTo(x + 4.5 * scale, y + 6 * scale);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const r = (ci >= 6 ? 5.2 : ci >= 4 ? 4.6 : 4.2) * scale;
  ctx.lineWidth = 1.8 * scale;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (ci >= 6) ctx.fill();
  ctx.stroke();
  if (ci >= 4) {
    const a = r * 1.05;
    ctx.beginPath();
    ctx.moveTo(x, y - a);
    ctx.bezierCurveTo(x + r * 0.4, y - a - r * 1.3, x + r * 1.6, y - a - r * 1.6, x + r * 2.5, y - a - r * 1.1);
    ctx.moveTo(x, y + a);
    ctx.bezierCurveTo(x - r * 0.4, y + a + r * 1.3, x - r * 1.6, y + a + r * 1.6, x - r * 2.5, y + a + r * 1.1);
    ctx.stroke();
  }
  ctx.restore();
}

function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, halo: string) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------- tracks

export interface TrackStyle {
  selected: boolean;
  hovered: boolean;
}

const isVortex = (ev: EventTrack) => ev.kind === 'cyclone' || ev.kind === 'wd';

export function drawTrack(f: Frame, ev: EventTrack, t: number, style: TrackStyle, fmtShort: (t: number) => string) {
  if (!isVortex(ev)) return;
  const { ctx, theme } = f;
  const pts = ev.points;
  if (pts.length < 2) return;
  const sel = style.selected;
  const strong = sel || style.hovered;
  const past = theme.ink;
  const futureColor = sel ? theme.track : strong ? theme.ink2 : theme.graphite;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Past (analysis) segment
  ctx.beginPath();
  let started = false;
  for (const p of pts) {
    if (p.t > 0) break;
    const [x, y] = P(f, p.lon, p.lat);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  const firstFuture = pts.findIndex((p) => p.t > 0);
  ctx.strokeStyle = past;
  ctx.globalAlpha = strong ? 0.95 : 0.6;
  ctx.lineWidth = sel ? 2 : 1.4;
  ctx.stroke();
  // Future (forecast) segment
  if (firstFuture >= 0) {
    ctx.beginPath();
    const startIdx = Math.max(0, firstFuture - 1);
    for (let i = startIdx; i < pts.length; i++) {
      const [x, y] = P(f, pts[i].lon, pts[i].lat);
      if (i === startIdx) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = futureColor;
    ctx.globalAlpha = sel ? 1 : strong ? 0.85 : 0.55;
    ctx.lineWidth = sel ? 2.2 : 1.3;
    ctx.setLineDash(sel ? [6, 4] : [4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
  // Six-hourly dots, symbols at 00 UTC, labels on the selected track.
  if (ev.kind === 'cyclone') {
    for (const p of pts) {
      const [x, y] = P(f, p.lon, p.lat);
      const isPast = p.t <= 0;
      const color = isPast ? past : futureColor;
      const day = ((p.t % 24) + 24) % 24 === 0;
      if (sel && day) {
        drawCycloneSymbol(ctx, x, y, p.cat, color, 0.8);
        if (p.t > 0 && p.t !== t) {
          ctx.font = font(f, 10, 600, 88);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          haloText(ctx, fmtShort(p.t), x + 9, y - 9, theme.track, theme.halo);
        }
      } else {
        ctx.beginPath();
        ctx.arc(x, y, sel ? 2 : 1.4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = strong ? 0.9 : 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.restore();
}

/** Position marker and label for an event at time t. Returns the hit point. */
export function drawEventNow(f: Frame, ev: EventTrack, p: TrackPoint, style: TrackStyle, label: string, sub: string): [number, number] {
  const { ctx, theme } = f;
  const [x, y] = P(f, p.lon, p.lat);
  const sel = style.selected;
  const color = sel ? theme.track : theme.ink;
  ctx.save();
  if (ev.kind === 'cyclone') {
    if (sel) {
      ctx.beginPath();
      ctx.arc(x, y, 13, 0, Math.PI * 2);
      ctx.fillStyle = theme.trackWash;
      ctx.fill();
    }
    drawCycloneSymbol(ctx, x, y, p.cat, color, sel ? 1.25 : 1.05);
  } else if (ev.kind === 'wd') {
    // Trough: a dashed, slightly tilted line through the centre.
    const [x1, y1] = P(f, p.lon - 1.2, p.lat + 4.5);
    const [x2, y2] = P(f, p.lon + 1.2, p.lat - 4.5);
    ctx.strokeStyle = color;
    ctx.lineWidth = sel ? 3.4 : 2.6;
    ctx.setLineDash([9, 6]);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (ev.kind === 'storm') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 6);
    ctx.lineTo(x + 5, y - 6);
    ctx.lineTo(x - 1, y + 1);
    ctx.lineTo(x + 5, y + 1);
    ctx.lineTo(x - 2, y + 8);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, sel ? 4 : 3, 0, Math.PI * 2);
    ctx.fillStyle = ev.kind === 'heat' ? theme.heat : ev.kind === 'cold' ? theme.cold : theme.rain;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = theme.halo;
    ctx.stroke();
  }
  if (label) {
    const lx = x + (ev.kind === 'cyclone' ? 15 : 10);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(f, 12.5, 650, 96);
    haloText(ctx, label, lx, y - 1, sel ? theme.track : theme.ink, theme.halo);
    if (sub) {
      ctx.font = font(f, 11, 500, 88);
      haloText(ctx, sub, lx, y + 12, theme.graphite, theme.halo);
    }
  }
  ctx.restore();
  return [x, y];
}

// ---------------------------------------------------------------- areal events

const patternCache = new Map<string, CanvasPattern>();

function hatch(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | string {
  const hit = patternCache.get(color);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 8;
  const g = c.getContext('2d')!;
  g.strokeStyle = color;
  g.lineWidth = 1.1;
  g.beginPath();
  g.moveTo(-2, 10);
  g.lineTo(10, -2);
  g.moveTo(6, 10);
  g.lineTo(10, 6);
  g.moveTo(-2, 2);
  g.lineTo(2, -2);
  g.stroke();
  const p = ctx.createPattern(c, 'repeat');
  if (!p) return color;
  patternCache.set(color, p);
  return p;
}

export function drawRegion(f: Frame, ev: EventTrack, p: TrackPoint, selected: boolean) {
  if (!p.rings?.length) return;
  const { ctx, theme } = f;
  const color = ev.kind === 'heat' ? theme.heat : ev.kind === 'cold' ? theme.cold : ev.kind === 'storm' ? theme.ink2 : theme.rain;
  const path = new Path2D();
  for (const ring of p.rings) {
    for (let i = 0; i < ring.length; i += 2) {
      const [x, y] = P(f, ring[i], ring[i + 1]);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
  }
  ctx.save();
  if (ev.kind === 'heat' || ev.kind === 'cold') {
    ctx.fillStyle = hatch(ctx, color);
    ctx.globalAlpha = selected ? 0.9 : 0.65;
    ctx.fill(path, 'evenodd');
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = selected ? theme.track : color;
  ctx.lineWidth = selected ? 2 : 1.2;
  if (ev.kind === 'rain') ctx.setLineDash([3, 3]);
  ctx.stroke(path);
  ctx.restore();
}

// ---------------------------------------------------------------- cone

export function drawCone(f: Frame, cone: Cone, showEllipses: boolean, fmtShort: (t: number) => string, tNow: number) {
  const { ctx, theme } = f;
  const ring = (flat: number[]) => {
    const path = new Path2D();
    for (let i = 0; i < flat.length; i += 2) {
      const [x, y] = P(f, flat[i], flat[i + 1]);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    return path;
  };
  ctx.save();
  if (cone.envelope90.length > 6) {
    const p90 = ring(cone.envelope90);
    ctx.strokeStyle = theme.trackLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.stroke(p90);
    ctx.setLineDash([]);
  }
  if (cone.envelope67.length > 6) {
    const p67 = ring(cone.envelope67);
    ctx.fillStyle = theme.trackWash;
    ctx.fill(p67);
    ctx.strokeStyle = theme.trackLine;
    ctx.lineWidth = 1.2;
    ctx.stroke(p67);
  }
  if (showEllipses) {
    ctx.font = font(f, 10, 600, 88);
    for (const e of cone.ellipses) {
      if (e.t % 24 !== 0 || e.t === 0) continue;
      const cx = P(f, e.lon, e.lat);
      const pxPerKm = f.view.k / 111.19;
      const th = ((90 - e.angle) * Math.PI) / 180;
      ctx.save();
      ctx.translate(cx[0], cx[1]);
      ctx.rotate(-th);
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(1, e.a * pxPerKm), Math.max(1, e.b * pxPerKm), 0, 0, Math.PI * 2);
      ctx.strokeStyle = e.t === tNow ? theme.track : theme.trackLine;
      ctx.lineWidth = e.t === tNow ? 1.6 : 0.9;
      ctx.stroke();
      ctx.restore();
      void fmtShort;
    }
  }
  ctx.restore();
}

export function drawSpaghetti(f: Frame, tracks: { points: { t: number; lon: number; lat: number }[] }[], color: string, alpha = 0.32) {
  const { ctx } = f;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  for (const tr of tracks) {
    ctx.beginPath();
    tr.points.forEach((p, i) => {
      const [x, y] = P(f, p.lon, p.lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.restore();
}

export function drawGhost(f: Frame, pts: { lon: number; lat: number }[], label: string, color: string, dash = [2, 3]) {
  const { ctx, theme } = f;
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.setLineDash(dash);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = P(f, p.lon, p.lat);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    const last = pts[pts.length - 1];
    const [x, y] = P(f, last.lon, last.lat);
    ctx.font = font(f, 10, 500, 88);
    ctx.textAlign = 'left';
    haloText(ctx, label, x + 4, y + 3, color, theme.halo);
  }
  ctx.restore();
}

export function drawTruth(f: Frame, pts: { lon: number; lat: number; t: number }[], t: number) {
  const { ctx, theme } = f;
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 3.5;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = P(f, p.lon, p.lat);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const now = pts.find((p) => p.t === t);
  if (now) {
    const [x, y] = P(f, now.lon, now.lat);
    ctx.beginPath();
    ctx.rect(x - 4, y - 4, 8, 8);
    ctx.fillStyle = theme.paper;
    ctx.fill();
    ctx.strokeStyle = theme.ink;
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- cities

export function drawCities(f: Frame, outlooks: CityOutlook[] | null, day: number, showWarnings: boolean, focusCity: string | null, occupied: { x: number; y: number; w: number; h: number }[]) {
  const { ctx, theme } = f;
  const zoomTier = f.view.k > 34 ? 3 : f.view.k > 20 ? 2 : 1;
  const levels = new Map<string, number>();
  if (outlooks && showWarnings) for (const o of outlooks) levels.set(o.city.id, o.days[Math.max(0, Math.min(o.days.length - 1, day - 1))]?.level ?? 0);
  ctx.save();
  const sorted = [...CITIES].sort((a, b) => a.tier - b.tier || b.pop - a.pop);
  for (const c of sorted) {
    const level = levels.get(c.id) ?? 0;
    const show = c.tier <= zoomTier || level >= 2 || c.id === focusCity;
    if (!show) continue;
    const [x, y] = P(f, c.lon, c.lat);
    if (x < -20 || y < -20 || x > f.w + 20 || y > f.h + 20) continue;
    const r = level >= 1 ? 4 : c.tier === 1 ? 2.6 : 2.1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (level >= 1) {
      ctx.fillStyle = theme.warn[level];
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = theme.halo;
      ctx.stroke();
    } else {
      ctx.fillStyle = theme.paper;
      ctx.fill();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = theme.ink2;
      ctx.stroke();
    }
    if (c.id === focusCity) {
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = theme.track;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const label = c.tier <= zoomTier || c.id === focusCity || (level >= 2 && f.view.k > 16);
    if (!label) continue;
    ctx.font = font(f, c.tier === 1 ? 11.5 : 10.5, c.tier === 1 ? 600 : 500, 90);
    const tw = ctx.measureText(c.name).width;
    const box = { x: x + 6, y: y - 7, w: tw + 2, h: 13 };
    if (occupied.some((o) => box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y)) continue;
    occupied.push(box);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    haloText(ctx, c.name, x + 6, y, c.tier === 1 ? theme.ink : theme.ink2, theme.halo);
  }
  ctx.restore();
}

export function lineLen(line: number[]) {
  return lineLength(line);
}
