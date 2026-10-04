// Event DNA visuals: the strip (one row per trait, one column per 6 hours)
// and the genome barcode for side-by-side comparison with relatives.

import type { DNA } from '../engine/dna';
import { useWidth } from './useSize';

export function DnaStrip({ dna, times, t, height = 13 }: { dna: DNA; times: number[]; t: number; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const labelW = 74;
  const cols = times.length;
  const cw = Math.max(2, (w - labelW) / Math.max(1, cols));
  const rows = dna.strip;
  const h = rows.length * height + 4;
  const tIdx = times.indexOf(t);
  const zero = times.findIndex((x) => x > 0);
  return (
    <div ref={ref} className="chart">
      <svg width={w} height={h} className="dna" role="img" aria-label="Event DNA strip">
        {rows.map((r, ri) => (
          <g key={r.key} transform={`translate(0, ${ri * height})`}>
            <text x={0} y={height - 3} className="dna__label">
              {r.label}
            </text>
            {r.values.map((v, ci) => (
              <rect key={ci} x={labelW + ci * cw} y={1} width={Math.max(1, cw - 0.6)} height={height - 2} className="dna__cell" style={{ opacity: 0.06 + 0.94 * v }}>
                <title>{`${r.label}: ${Math.round(v * 100)}% of scale`}</title>
              </rect>
            ))}
          </g>
        ))}
        {zero > 0 && <line x1={labelW + zero * cw - 0.3} x2={labelW + zero * cw - 0.3} y1={0} y2={h - 3} className="dna__analysis" />}
        {tIdx >= 0 && <rect x={labelW + tIdx * cw - 0.5} y={0} width={cw} height={h - 3} className="dna__cursor" />}
      </svg>
    </div>
  );
}

export function GenomeBars({
  values,
  labels,
  compare,
  height = 34,
  highlight,
}: {
  values: number[];
  labels: string[];
  compare?: number[];
  height?: number;
  highlight?: boolean;
}) {
  const n = values.length;
  const bw = 9;
  const gap = 3;
  const w = n * (bw + gap);
  return (
    <svg width={w} height={height} className={`genome ${highlight ? 'genome--hl' : ''}`} role="img" aria-label="Genome barcode">
      {values.map((v, i) => (
        <g key={i} transform={`translate(${i * (bw + gap)}, 0)`}>
          <rect y={0} width={bw} height={height} className="genome__slot" />
          <rect y={height - v * height} width={bw} height={Math.max(1, v * height)} className="genome__bar" />
          {compare && <line x1={-1} x2={bw + 1} y1={height - compare[i] * height} y2={height - compare[i] * height} className="genome__cmp" />}
          <title>{`${labels[i]}: ${Math.round(v * 100)}%${compare ? ` (live event ${Math.round(compare[i] * 100)}%)` : ''}`}</title>
        </g>
      ))}
    </svg>
  );
}
