// Lifecycle chart: intensity through the event's life, IMD category bands,
// lifecycle stages, the ensemble fan for the forecast part, milestones, and
// (in reveal mode) what actually happened.

import type { Cone } from '../engine/cone';
import type { EventTrack } from '../engine/events';
import { CAT_BANDS } from '../engine/imd';
import { intensityOf, STAGE_LABEL, type Stage } from '../engine/lifecycle';
import { useWidth } from './useSize';

const STAGE_TONE: Record<Stage, number> = { genesis: 0.18, intensifying: 0.55, mature: 0.85, steady: 0.35, weakening: 0.45, dissipating: 0.15 };

export function LifecycleChart(props: {
  ev: EventTrack;
  t: number;
  cone?: Cone | null;
  truth?: { t: number[]; v: number[] } | null;
  fmtDay: (t: number) => string;
  height?: number;
  onSetT?: (t: number) => void;
}) {
  const { ev, t, cone } = props;
  const [ref, w] = useWidth<HTMLDivElement>();
  const h = props.height ?? 176;
  const pad = { l: 34, r: ev.kind === 'cyclone' ? 44 : 10, t: 10, b: 34 };
  const t0 = Math.min(ev.t0, props.truth?.t[0] ?? ev.t0);
  const t1 = Math.max(ev.t1, cone?.ellipses[cone.ellipses.length - 1]?.t ?? ev.t1, props.truth?.t[props.truth.t.length - 1] ?? ev.t1);
  const span = Math.max(12, t1 - t0);
  const vals = ev.points.map((p) => intensityOf(ev.kind, p));
  const fanMax = cone ? Math.max(...cone.ellipses.map((e) => e.vmax.p90)) : 0;
  const truthMax = props.truth ? Math.max(...props.truth.v) : 0;
  const vmax = ev.kind === 'cyclone' ? Math.max(40, Math.ceil((Math.max(...vals, fanMax, truthMax) + 8) / 10) * 10) : Math.max(...vals) * 1.15 || 1;
  const x = (tt: number) => pad.l + ((tt - t0) / span) * (w - pad.l - pad.r);
  const y = (v: number) => h - pad.b - (Math.min(v, vmax) / vmax) * (h - pad.t - pad.b);
  const line = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)} ${y(b).toFixed(1)}`).join(' ');
  const past = ev.points.filter((p) => p.t <= 0).map((p) => [p.t, intensityOf(ev.kind, p)] as [number, number]);
  const futureStart = ev.points.findIndex((p) => p.t > 0);
  const future = futureStart >= 0 ? ev.points.slice(Math.max(0, futureStart - 1)).map((p) => [p.t, intensityOf(ev.kind, p)] as [number, number]) : [];
  const fan = cone && ev.kind === 'cyclone' ? cone.ellipses : [];
  const band = (lo: (e: (typeof fan)[number]) => number, hi: (e: (typeof fan)[number]) => number) =>
    fan.length > 1 ? `${fan.map((e, i) => `${i ? 'L' : 'M'}${x(e.t).toFixed(1)} ${y(hi(e)).toFixed(1)}`).join(' ')} ${[...fan].reverse().map((e) => `L${x(e.t).toFixed(1)} ${y(lo(e)).toFixed(1)}`).join(' ')} Z` : '';
  const days: number[] = [];
  for (let d = Math.ceil(t0 / 24) * 24; d <= t1; d += 24) days.push(d);
  const stageY = h - pad.b + 6;
  const stepW = (6 / span) * (w - pad.l - pad.r);

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!props.onSetT) return;
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const tt = t0 + ((e.clientX - r.left - pad.l) / (w - pad.l - pad.r)) * span;
    props.onSetT(tt);
  };

  return (
    <div ref={ref} className="chart">
      <svg width={w} height={h} onClick={onClick} className="lifecycle" role="img" aria-label="Intensity through the event's life">
        {ev.kind === 'cyclone' &&
          CAT_BANDS.filter((b) => b.from < vmax).map((b, i) => (
            <g key={b.code}>
              <rect x={pad.l} y={y(Math.min(b.to, vmax))} width={w - pad.l - pad.r} height={y(b.from) - y(Math.min(b.to, vmax))} className={i % 2 ? 'lc-band lc-band--alt' : 'lc-band'} />
              <text x={w - pad.r + 4} y={(y(b.from) + y(Math.min(b.to, vmax))) / 2 + 3} className="lc-band-label">
                {b.code === 'L' ? 'Low' : b.code}
              </text>
            </g>
          ))}
        {days.map((d) => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={pad.t} y2={h - pad.b} className="lc-grid" />
            <text x={x(d) + 3} y={h - 6} className="lc-axis">
              {props.fmtDay(d)}
            </text>
          </g>
        ))}
        {ev.kind === 'cyclone' &&
          [0, 34, 64, 90, 120].filter((v) => v < vmax).map((v) => (
            <text key={v} x={pad.l - 6} y={y(v) + 3} className="lc-axis" textAnchor="end">
              {v}
            </text>
          ))}
        {ev.kind === 'cyclone' && (
          <text x={4} y={pad.t + 6} className="lc-axis">
            kt
          </text>
        )}
        {fan.length > 1 && (
          <>
            <path d={band((e) => e.vmax.p10, (e) => e.vmax.p90)} className="lc-fan" />
            <path d={band((e) => e.vmax.p25, (e) => e.vmax.p75)} className="lc-fan lc-fan--inner" />
          </>
        )}
        {x(0) > pad.l && x(0) < w - pad.r && <line x1={x(0)} x2={x(0)} y1={pad.t} y2={h - pad.b} className="lc-analysis" />}
        {past.length > 1 && <path d={line(past)} className="lc-line" />}
        {future.length > 1 && <path d={line(future)} className="lc-line lc-line--future" />}
        {props.truth && props.truth.t.length > 1 && <path d={line(props.truth.t.map((tt, i) => [tt, props.truth!.v[i]] as [number, number]))} className="lc-truth" />}
        {ev.milestones
          .filter((m) => ['landfall', 'peak', 'ri', 'named'].includes(m.type))
          .map((m, i) => {
            const p = ev.points.reduce((a, b) => (Math.abs(b.t - m.t) < Math.abs(a.t - m.t) ? b : a));
            return (
              <g key={i} transform={`translate(${x(m.t)}, ${y(intensityOf(ev.kind, p))})`}>
                {m.type === 'landfall' ? <path d="M0 -6 L5 3 L-5 3 Z" className="lc-mark lc-mark--landfall" /> : <circle r={3} className="lc-mark" />}
                <title>{m.label}</title>
              </g>
            );
          })}
        {ev.stages.map((s, i) => (
          <rect key={i} x={x(ev.points[i].t) - stepW / 2} y={stageY} width={stepW + 0.3} height={6} className="lc-stage" style={{ opacity: STAGE_TONE[s] }}>
            <title>{STAGE_LABEL[s]}</title>
          </rect>
        ))}
        {t >= t0 && t <= t1 && (
          <g transform={`translate(${x(t)}, 0)`}>
            <line y1={pad.t} y2={h - pad.b + 12} className="lc-playhead" />
          </g>
        )}
      </svg>
      <StageLegend stages={ev.stages} />
    </div>
  );
}

function StageLegend({ stages }: { stages: Stage[] }) {
  const seen = [...new Set(stages)];
  return (
    <div className="lc-legend">
      {seen.map((s) => (
        <span key={s}>
          <i style={{ opacity: STAGE_TONE[s] }} />
          {STAGE_LABEL[s]}
        </span>
      ))}
    </div>
  );
}
