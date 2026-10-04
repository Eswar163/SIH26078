// Timeline with event lifelines. Each row is one event's life from genesis to
// dissipation, shaded by strength; the analysis line separates what has been
// observed from what is forecast; lineage links connect parents and children.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EventTrack } from '../engine/events';
import { catIndex } from '../engine/imd';
import { intensityOf } from '../engine/lifecycle';
import { useFmt } from '../state/format';
import { useStore } from '../state/store';
import { IconPause, IconPlay, IconStepBack, IconStepFwd } from '../ui/icons';
import { KindGlyph } from '../ui/kind';

const LABEL_W = 156;
const ROW_H = 22;
const AXIS_H = 22;

interface Row {
  key: string;
  label: string;
  kind: EventTrack['kind'];
  events: { ev: EventTrack; lane: number }[];
  lanes: number;
}

function buildRows(events: EventTrack[]): Row[] {
  const rows: Row[] = [];
  const singles = events
    .filter((e) => e.kind === 'cyclone' || e.kind === 'wd' || e.kind === 'heat' || e.kind === 'cold')
    .sort((a, b) => {
      const order = { cyclone: 0, wd: 1, heat: 2, cold: 3, rain: 4, storm: 5 };
      return order[a.kind] - order[b.kind] || (a.kind === 'cyclone' ? catIndex(b.maxCat) - catIndex(a.maxCat) : 0) || a.t0 - b.t0;
    });
  for (const ev of singles) {
    rows.push({ key: ev.id, label: ev.kind === 'cyclone' && ev.name ? ev.name : ev.label, kind: ev.kind, events: [{ ev, lane: 0 }], lanes: 1 });
  }
  for (const kind of ['rain', 'storm'] as const) {
    const list = events.filter((e) => e.kind === kind).sort((a, b) => a.t0 - b.t0);
    if (!list.length) continue;
    const laneEnd: number[] = [];
    const placed = list.map((ev) => {
      let lane = laneEnd.findIndex((end) => end < ev.t0);
      if (lane < 0) {
        lane = laneEnd.length;
        laneEnd.push(ev.t1);
      } else laneEnd[lane] = ev.t1;
      return { ev, lane: Math.min(lane, 3) };
    });
    rows.push({ key: `group-${kind}`, label: kind === 'rain' ? `Heavy rain (${list.length})` : `Thunderstorms (${list.length})`, kind, events: placed, lanes: Math.min(4, laneEnd.length) });
  }
  return rows;
}

export function Timeline() {
  const run = useStore((s) => s.run);
  const t = useStore((s) => s.t);
  const setT = useStore((s) => s.setT);
  const step = useStore((s) => s.step);
  const playing = useStore((s) => s.playing);
  const togglePlay = useStore((s) => s.togglePlay);
  const selectedId = useStore((s) => s.selectedId);
  const hoverId = useStore((s) => s.hoverId);
  const select = useStore((s) => s.select);
  const hover = useStore((s) => s.hover);
  const fmt = useFmt();
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => (run ? buildRows(run.events) : []), [run]);
  if (!run) return <section className="timeline timeline--empty" />;
  const tMin = run.times[0];
  const tMax = run.times[run.times.length - 1];
  const plotW = Math.max(100, w - LABEL_W - 16);
  const x = (tt: number) => LABEL_W + ((tt - tMin) / (tMax - tMin)) * plotW;
  const stepW = (6 / (tMax - tMin)) * plotW;
  const height = AXIS_H + rows.length * ROW_H + 6;

  const timeFromEvent = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const px = clientX - r.left;
    return tMin + ((px - LABEL_W) / plotW) * (tMax - tMin);
  };

  const onDown = (e: React.PointerEvent<SVGRectElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    setT(timeFromEvent(e.clientX));
  };
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.buttons & 1) setT(timeFromEvent(e.clientX));
  };

  const days: number[] = [];
  for (let tt = Math.ceil(tMin / 24) * 24; tt <= tMax; tt += 24) days.push(tt);
  const relations = run.relations.filter((r) => r.type !== 'rainband');
  const rowOf = (id: string) => rows.findIndex((r) => r.events.some((e) => e.ev.id === id));

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline__bar">
        <div className="timeline__controls">
          <button className="btn btn--icon btn--ghost" onClick={() => step(-6)} aria-label="Back 6 hours" title="Back 6 h (Left arrow)">
            <IconStepBack />
          </button>
          <button className="btn btn--icon" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (Space)">
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button className="btn btn--icon btn--ghost" onClick={() => step(6)} aria-label="Forward 6 hours" title="Forward 6 h (Right arrow)">
            <IconStepFwd />
          </button>
        </div>
        <div className="timeline__now">
          <span className="timeline__time num">{fmt.time(t)}</span>
          <span className={`chip num ${t > 0 ? 'chip--track' : ''}`}>{t === 0 ? 'Analysis' : t > 0 ? `Forecast ${fmt.lead(t)}` : `Observed ${fmt.lead(t)}`}</span>
        </div>
        <div className="timeline__key muted">
          <span className="key key--past" /> Observed
          <span className="key key--future" /> Forecast
        </div>
      </div>
      <div className="timeline__plot" ref={box}>
        <svg width={w} height={height} className="timeline__svg">
          <rect x={LABEL_W} y={0} width={Math.max(0, x(0) - LABEL_W)} height={height} className="tl-past" />
          {days.map((d, i) => {
            // Narrow screens: date number only, and every other day when very tight.
            const pxPerDay = (24 / (tMax - tMin)) * plotW;
            const label = pxPerDay >= 64 ? fmt.day(d) : fmt.day(d).split(' ')[1];
            const show = pxPerDay >= 22 || i % 2 === 0;
            return (
              <g key={d}>
                <line x1={x(d)} x2={x(d)} y1={AXIS_H - 6} y2={height} className="tl-grid" />
                {show && (
                  <text x={x(d) + 4} y={14} className="tl-day">
                    {label}
                  </text>
                )}
              </g>
            );
          })}
          {run.times.map((tt) => (
            <line key={tt} x1={x(tt)} x2={x(tt)} y1={AXIS_H - 4} y2={AXIS_H} className="tl-tick" />
          ))}
          <line x1={x(0)} x2={x(0)} y1={0} y2={height} className="tl-analysis" />
          <rect x={LABEL_W} y={0} width={plotW} height={height} fill="transparent" onPointerDown={onDown} onPointerMove={onMove} style={{ cursor: 'ew-resize' }} />
          {rows.map((row, ri) => {
            const y0 = AXIS_H + ri * ROW_H;
            const rowSel = row.events.some((e) => e.ev.id === selectedId);
            return (
              <g key={row.key} className={rowSel ? 'tl-row tl-row--sel' : 'tl-row'}>
                <foreignObject x={0} y={y0} width={LABEL_W - 8} height={ROW_H}>
                  <button
                    className="tl-label"
                    onClick={() => select(row.events[0].ev.id)}
                    onMouseEnter={() => hover(row.events[0].ev.id)}
                    onMouseLeave={() => hover(null)}
                    title={row.label}
                  >
                    <KindGlyph kind={row.kind} cat={row.events[0].ev.maxCat} />
                    <span>{row.label}</span>
                  </button>
                </foreignObject>
                {row.events.map(({ ev, lane }) => {
                  const laneH = row.lanes > 1 ? Math.max(3, (ROW_H - 10) / row.lanes) : 9;
                  const by = y0 + (row.lanes > 1 ? 5 + lane * laneH : (ROW_H - laneH) / 2);
                  const maxI = Math.max(1e-6, ...ev.points.map((p) => intensityOf(ev.kind, p)));
                  const sel = ev.id === selectedId;
                  const hov = ev.id === hoverId;
                  return (
                    <g
                      key={ev.id}
                      onClick={() => select(ev.id)}
                      onMouseEnter={() => hover(ev.id)}
                      onMouseLeave={() => hover(null)}
                      style={{ cursor: 'pointer' }}
                    >
                      {ev.points.map((p, i) => {
                        const v = ev.kind === 'cyclone' ? catIndex(p.cat) / 8 : intensityOf(ev.kind, p) / maxI;
                        return (
                          <rect
                            key={i}
                            x={x(p.t) - stepW / 2}
                            y={by}
                            width={stepW + 0.5}
                            height={laneH}
                            className={`tl-seg tl-seg--${ev.kind}`}
                            style={{ opacity: (p.t > 0 ? 0.55 : 1) * (0.28 + 0.72 * v) }}
                          />
                        );
                      })}
                      {(sel || hov) && (
                        <rect x={x(ev.t0) - stepW / 2 - 1.5} y={by - 1.5} width={x(ev.t1) - x(ev.t0) + stepW + 3} height={laneH + 3} className={sel ? 'tl-outline tl-outline--sel' : 'tl-outline'} rx={2} />
                      )}
                      {row.lanes === 1 &&
                        ev.milestones
                          .filter((m) => m.type === 'landfall' || m.type === 'ri' || m.type === 'named')
                          .map((m, k) => (
                            <g key={k} transform={`translate(${x(m.t)}, ${by + laneH + 1})`}>
                              {m.type === 'landfall' ? <path d="M0 -1 L3.5 5 L-3.5 5 Z" className="tl-mark tl-mark--landfall" /> : <circle r={2.2} cy={2} className="tl-mark" />}
                              <title>{m.label}</title>
                            </g>
                          ))}
                      <title>{`${ev.label}${ev.name ? ` (${ev.name})` : ''}: ${fmt.time(ev.t0)} to ${fmt.time(ev.t1)}`}</title>
                    </g>
                  );
                })}
              </g>
            );
          })}
          {relations.map((r, k) => {
            const a = rowOf(r.from);
            const b = rowOf(r.to);
            if (a < 0 || b < 0 || a === b) return null;
            const xa = x(r.t);
            const ya = AXIS_H + a * ROW_H + ROW_H / 2;
            const yb = AXIS_H + b * ROW_H + ROW_H / 2;
            return (
              <g key={k} className="tl-link">
                <path d={`M${xa - 8} ${ya} C ${xa + 4} ${ya}, ${xa - 4} ${yb}, ${xa + 6} ${yb}`} />
                <title>{r.type}</title>
              </g>
            );
          })}
          <g className="tl-playhead" transform={`translate(${x(t)}, 0)`}>
            <line y1={0} y2={height} />
            <path d="M-5 0 L5 0 L5 6 L0 11 L-5 6 Z" />
          </g>
        </svg>
      </div>
    </section>
  );
}
