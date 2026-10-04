// Landfall probability along the coastline, unrolled from Yemen to Myanmar.
// Segments are coloured by state or country; the curve is the ensemble's
// landfall density; ticks are individual members; the bracket is the shortest
// stretch holding half of the landfalls.

import type { Cone } from '../engine/cone';
import { COAST, COAST_ARC, COAST_SEGMENTS } from '../engine/places';
import { useWidth } from './useSize';

export function CoastRibbon({ cone, modelArc, height = 128, fmtTime }: { cone: Cone; modelArc: number | null; height?: number; fmtTime: (t: number) => string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const L = cone.landfall;
  const arcs = L.points.filter((p) => p.arcKm >= 0).map((p) => p.arcKm);
  if (modelArc !== null && modelArc >= 0) arcs.push(modelArc);
  if (!arcs.length) {
    return (
      <div ref={ref} className="ribbon-empty muted">
        {L.members ? 'Landfalls fall outside the mapped coastline (islands or Sri Lanka).' : 'No ensemble member makes landfall in the forecast window.'}
      </div>
    );
  }
  const lo = Math.max(0, Math.min(...arcs) - 450);
  const hi = Math.min(COAST_ARC[COAST_ARC.length - 1], Math.max(...arcs) + 450);
  const pad = 8;
  const x = (a: number) => pad + ((a - lo) / (hi - lo)) * (w - pad * 2);
  const base = height - 46;
  const maxP = Math.max(0.05, ...L.density.filter((d) => d.arcKm >= lo && d.arcKm <= hi).map((d) => d.p));
  const y = (p: number) => base - (p / maxP) * (base - 14);
  const dens = L.density.filter((d) => d.arcKm >= lo && d.arcKm <= hi);
  const area = dens.length ? `M${x(dens[0].arcKm)} ${base} ${dens.map((d) => `L${x(d.arcKm).toFixed(1)} ${y(d.p).toFixed(1)}`).join(' ')} L${x(dens[dens.length - 1].arcKm)} ${base} Z` : '';
  const towns = COAST.map((c, i) => ({ c, a: COAST_ARC[i] })).filter((o) => o.a >= lo && o.a <= hi);
  const placed: number[] = [];
  const labelled = towns.filter((o) => {
    const px = x(o.a);
    if (placed.some((q) => Math.abs(q - px) < 58)) return false;
    placed.push(px);
    return true;
  });
  return (
    <div ref={ref} className="chart">
      <svg width={w} height={height} className="ribbon" role="img" aria-label="Landfall probability along the coast">
        {COAST_SEGMENTS.filter((s) => s.to >= lo && s.from <= hi).map((s, i) => {
          const a = Math.max(lo, s.from);
          const b = Math.min(hi, s.to);
          return (
            <g key={s.region + i}>
              <rect x={x(a)} y={base} width={Math.max(0, x(b) - x(a))} height={8} className={i % 2 ? 'ribbon__seg ribbon__seg--alt' : 'ribbon__seg'} />
              {x(b) - x(a) > 46 && (
                <text x={(x(a) + x(b)) / 2} y={base + 20} className="ribbon__region" textAnchor="middle">
                  {s.region}
                </text>
              )}
            </g>
          );
        })}
        {L.likely && (
          <g className="ribbon__likely">
            <path d={`M${x(L.likely.from)} ${base - 3} V ${10} H ${x(L.likely.to)} V ${base - 3}`} />
            <text x={(x(L.likely.from) + x(L.likely.to)) / 2} y={8} textAnchor="middle">
              Half of landfalls
            </text>
          </g>
        )}
        <path d={area} className="ribbon__area" />
        {L.points
          .filter((p) => p.arcKm >= lo && p.arcKm <= hi)
          .map((p) => (
            <line key={p.member} x1={x(p.arcKm)} x2={x(p.arcKm)} y1={base - 5} y2={base} className="ribbon__member">
              <title>{`Member ${p.member}: ${fmtTime(Math.round(p.t))}, ${Math.round(p.vmax)} kt`}</title>
            </line>
          ))}
        {modelArc !== null && modelArc >= lo && modelArc <= hi && (
          <g transform={`translate(${x(modelArc)}, ${base})`} className="ribbon__model">
            <path d="M0 -2 L5 -10 L-5 -10 Z" />
            <title>Deterministic model landfall</title>
          </g>
        )}
        {labelled.map((o) => (
          <g key={o.c.name} transform={`translate(${x(o.a)}, ${base + 8})`}>
            <line y1={0} y2={18} className="ribbon__town-tick" />
            <text y={34} className="ribbon__town" textAnchor="middle">
              {o.c.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
