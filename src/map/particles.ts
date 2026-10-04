// Animated 10 m wind flow: particles advected through the wind field, drawn
// with fading trails on their own canvas.

import type { GridSpec } from '../engine/grid';
import { sample } from '../engine/grid';
import { project, unproject, type MapViewState } from './view';

interface Particle {
  lon: number;
  lat: number;
  age: number;
  life: number;
}

export class FlowLayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private raf = 0;
  private running = false;
  private view: MapViewState | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private g: GridSpec | null = null;
  private u: Float32Array | null = null;
  private v: Float32Array | null = null;
  private color = 'rgba(21,35,43,0.5)';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  setData(g: GridSpec, u: Float32Array, v: Float32Array) {
    this.g = g;
    this.u = u;
    this.v = v;
  }

  setView(view: MapViewState, w: number, h: number, dpr: number) {
    const resized = w !== this.w || h !== this.h || dpr !== this.dpr;
    this.view = view;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    if (resized) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    this.seed();
  }

  setColor(c: string) {
    this.color = c;
  }

  private spawn(p?: Particle): Particle {
    const [lon, lat] = unproject(this.view!, this.w, this.h, Math.random() * this.w, Math.random() * this.h);
    const life = 40 + Math.random() * 60;
    if (p) {
      p.lon = lon;
      p.lat = lat;
      p.age = 0;
      p.life = life;
      return p;
    }
    return { lon, lat, age: Math.random() * life, life };
  }

  private seed() {
    if (!this.view) return;
    const n = Math.max(600, Math.min(4200, Math.round((this.w * this.h) / 300)));
    this.particles = Array.from({ length: n }, () => this.spawn());
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.frame();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  private frame() {
    const { ctx, g, u, v, view } = this;
    if (!g || !u || !v || !view) return;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Degrees moved per frame per m/s, tuned so motion reads at any zoom.
    const step = 0.0026 * Math.max(0.6, Math.min(2.2, 26 / view.k));
    const lonMax = g.lon0 + (g.nx - 1) * g.d;
    const latMax = g.lat0 + (g.ny - 1) * g.d;
    for (const p of this.particles) {
      if (p.age++ > p.life || p.lon < g.lon0 || p.lon > lonMax || p.lat < g.lat0 || p.lat > latMax) {
        this.spawn(p);
        continue;
      }
      const uu = sample(g, u, p.lon, p.lat);
      const vv = sample(g, v, p.lon, p.lat);
      const [x0, y0] = project(view, this.w, this.h, p.lon, p.lat);
      p.lon += (uu * step) / Math.cos((p.lat * Math.PI) / 180);
      p.lat += vv * step;
      const [x1, y1] = project(view, this.w, this.h, p.lon, p.lat);
      if (x1 < 0 || y1 < 0 || x1 > this.w || y1 > this.h) {
        this.spawn(p);
        continue;
      }
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
  }
}
