// Rapid-intensification guidance: a logistic regression trained in the browser
// on the Event Memory archive (every 6-hourly over-sea point of every
// cyclonic system). Target: an increase of at least 30 kt in the next 24 h,
// the standard RI definition. The model is small enough to explain: each
// prediction comes with the contribution of every predictor.

import type { ArchiveEvent } from './archive';
import type { EventTrack } from './events';

export const RI_FEATURES = ['Current intensity', 'Last 12 h change', 'Sea temperature', 'Wind shear', 'Mid-level humidity', 'Latitude', 'Forward speed'] as const;

export interface RiModel {
  weights: number[];
  bias: number;
  mean: number[];
  std: number[];
  samples: number;
  positives: number;
  auc: number;
  brier: number;
  climatology: number;
}

interface Sample {
  x: number[];
  y: number;
}

function features(vmax: number, dv12: number, sst: number, shear: number, rh: number, lat: number, speed: number): number[] {
  return [vmax, dv12, sst, shear, rh, lat, speed];
}

function samplesFrom(points: { t: number; vmax?: number; overLand: boolean; lat: number; lon: number }[], env: { sst: number[]; shear: number[]; rh: number[] }): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.overLand || (p.vmax ?? 0) < 20) continue;
    const prev = points.find((q) => q.t === p.t - 12);
    const next = points.find((q) => q.t === p.t + 24);
    if (!prev || !next) continue;
    const b = points[Math.min(points.length - 1, i + 1)];
    const a = points[Math.max(0, i - 1)];
    const dt = b.t - a.t || 1;
    const speed = (Math.hypot((b.lon - a.lon) * Math.cos((p.lat * Math.PI) / 180), b.lat - a.lat) * 111.2) / dt;
    out.push({
      x: features(p.vmax ?? 0, (p.vmax ?? 0) - (prev.vmax ?? 0), env.sst[i], env.shear[i], env.rh[i], p.lat, speed),
      y: (next.vmax ?? 0) - (p.vmax ?? 0) >= 30 ? 1 : 0,
    });
  }
  return out;
}

export function trainRiModel(archive: ArchiveEvent[]): RiModel {
  const all: Sample[] = [];
  for (const ev of archive) if (ev.kind === 'cyclone' && ev.env) all.push(...samplesFrom(ev.points, ev.env));
  const d = RI_FEATURES.length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const s of all) for (let k = 0; k < d; k++) mean[k] += s.x[k] / all.length;
  for (const s of all) for (let k = 0; k < d; k++) std[k] += (s.x[k] - mean[k]) ** 2 / all.length;
  for (let k = 0; k < d; k++) std[k] = Math.sqrt(std[k]) || 1;
  const z = all.map((s) => ({ x: s.x.map((v, k) => (v - mean[k]) / std[k]), y: s.y }));
  // Deterministic 80/20 split.
  const train = z.filter((_, i) => i % 5 !== 0);
  const test = z.filter((_, i) => i % 5 === 0);
  const pos = train.filter((s) => s.y === 1).length;
  const wPos = pos > 0 ? (train.length - pos) / pos : 1;
  let w = new Array(d).fill(0);
  let b = 0;
  const lr = 0.08;
  const l2 = 0.002;
  for (let epoch = 0; epoch < 400; epoch++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    let wsum = 0;
    for (const s of train) {
      const p = sigmoid(dot(w, s.x) + b);
      const sw = s.y === 1 ? Math.sqrt(wPos) : 1;
      const e = (p - s.y) * sw;
      for (let k = 0; k < d; k++) gw[k] += e * s.x[k];
      gb += e;
      wsum += sw;
    }
    w = w.map((wk, k) => wk - lr * (gw[k] / wsum + l2 * wk));
    b -= lr * (gb / wsum);
  }
  // Recalibrate the intercept so mean predicted probability matches the base rate.
  const base = all.filter((s) => s.y === 1).length / Math.max(1, all.length);
  for (let it = 0; it < 30; it++) {
    const m = train.reduce((s, x) => s + sigmoid(dot(w, x.x) + b), 0) / train.length;
    b += Math.log(base / (1 - base)) - Math.log(m / (1 - m));
  }
  const preds = test.map((s) => ({ p: sigmoid(dot(w, s.x) + b), y: s.y }));
  return {
    weights: w,
    bias: b,
    mean,
    std,
    samples: all.length,
    positives: all.filter((s) => s.y === 1).length,
    auc: auc(preds),
    brier: preds.reduce((s, q) => s + (q.p - q.y) ** 2, 0) / Math.max(1, preds.length),
    climatology: base,
  };
}

export interface RiPrediction {
  t: number;
  probability: number;
  contributions: { feature: string; value: number; effect: number }[];
}

/** RI probability at a track point; null when not applicable (over land, too weak). */
export function predictRi(model: RiModel, ev: EventTrack, i: number): RiPrediction | null {
  const p = ev.points[i];
  if (!ev.env || p.overLand || (p.vmax ?? 0) < 20) return null;
  const prev = ev.points.find((q) => q.t === p.t - 12) ?? ev.points[0];
  const raw = features(p.vmax ?? 0, (p.vmax ?? 0) - (prev.vmax ?? 0), ev.env.sst[i], ev.env.shear[i], ev.env.rh[i], p.lat, ev.speed[i] ?? 10);
  const x = raw.map((v, k) => (v - model.mean[k]) / model.std[k]);
  const logit = dot(model.weights, x) + model.bias;
  return {
    t: p.t,
    probability: sigmoid(logit),
    contributions: RI_FEATURES.map((feature, k) => ({ feature, value: raw[k], effect: model.weights[k] * x[k] })).sort(
      (a, b) => Math.abs(b.effect) - Math.abs(a.effect),
    ),
  };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

function auc(preds: { p: number; y: number }[]): number {
  const pos = preds.filter((q) => q.y === 1).map((q) => q.p);
  const neg = preds.filter((q) => q.y === 0).map((q) => q.p);
  if (!pos.length || !neg.length) return 0.5;
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}
