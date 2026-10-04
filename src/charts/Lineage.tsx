// Genealogy: the family of related events on a shared time axis. Bars are
// lives; curves are the relations (split, merge, regeneration, induction,
// rain shield) at the moment they happened.

import type { RelationType } from '../engine/track';
import { useWidth } from './useSize';

export interface LineageNode {
  id: string;
  label: string;
  sub?: string;
  t0: number;
  t1: number;
  kind: string;
}

export interface LineageEdge {
  from: string;
  to: string;
  type: RelationType;
  t: number;
}

export const RELATION_WORDS: Record<RelationType, string> = {
  split: 'split from',
  merge: 'merged into',
  regenerated: 'regenerated from',
  induced: 'induced by',
  rainband: 'rain shield of',
};

export function familyOf(id: string, edges: LineageEdge[]): Set<string> {
  const seen = new Set([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of edges) {
      const other = e.from === cur ? e.to : e.to === cur ? e.from : null;
      if (other && !seen.has(other)) {
        seen.add(other);
        stack.push(other);
      }
    }
  }
  return seen;
}

export function LineageChart({
  nodes,
  edges,
  selected,
  onSelect,
  fmtDay,
  axisFrom,
  axisTo,
}: {
  nodes: LineageNode[];
  edges: LineageEdge[];
  selected: string;
  onSelect?: (id: string) => void;
  fmtDay?: (t: number) => string;
  axisFrom?: number;
  axisTo?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const ordered = [...nodes].sort((a, b) => a.t0 - b.t0);
  const rowH = 34;
  const pad = { l: 8, r: 8, t: 18 };
  const t0 = axisFrom ?? Math.min(...ordered.map((n) => n.t0));
  const t1 = axisTo ?? Math.max(...ordered.map((n) => n.t1));
  const span = Math.max(12, t1 - t0);
  const x = (t: number) => pad.l + ((t - t0) / span) * (w - pad.l - pad.r);
  const row = new Map(ordered.map((n, i) => [n.id, i]));
  const h = pad.t + ordered.length * rowH + 6;
  const days: number[] = [];
  for (let d = Math.ceil(t0 / 24) * 24; d <= t1; d += 24) days.push(d);
  return (
    <div ref={ref} className="chart">
      <svg width={w} height={h} className="lineage" role="img" aria-label="Event family tree">
        {fmtDay &&
          days.map((d) => (
            <g key={d}>
              <line x1={x(d)} x2={x(d)} y1={pad.t - 4} y2={h} className="lin-grid" />
              {days.length < 12 && (
                <text x={x(d) + 3} y={11} className="lin-axis">
                  {fmtDay(d)}
                </text>
              )}
            </g>
          ))}
        {edges.map((e, i) => {
          const a = row.get(e.from);
          const b = row.get(e.to);
          if (a === undefined || b === undefined) return null;
          const xa = x(e.t);
          const ya = pad.t + a * rowH + 9;
          const yb = pad.t + b * rowH + 9;
          return (
            <g key={i} className={`lin-edge lin-edge--${e.type}`}>
              <path d={`M${xa} ${ya} C ${xa + 18} ${ya}, ${xa - 18} ${yb}, ${xa} ${yb}`} />
              <circle cx={xa} cy={yb} r={2.6} />
              <title>{`${e.to} ${RELATION_WORDS[e.type]} ${e.from}`}</title>
            </g>
          );
        })}
        {ordered.map((n, i) => {
          const y0 = pad.t + i * rowH;
          const sel = n.id === selected;
          return (
            <g key={n.id} className={`lin-node ${sel ? 'lin-node--sel' : ''}`} onClick={() => onSelect?.(n.id)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
              <rect x={x(n.t0)} y={y0 + 5} width={Math.max(4, x(n.t1) - x(n.t0))} height={8} rx={2} className={`lin-bar lin-bar--${n.kind}`} />
              <text x={Math.min(x(n.t0), w - 140)} y={y0 + 27} className="lin-label">
                {n.label}
                {n.sub ? <tspan className="lin-sub"> {n.sub}</tspan> : null}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
