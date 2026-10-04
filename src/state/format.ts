import { useMemo } from 'react';
import { fmtDay, fmtLead, fmtTime, dateAt } from '../engine/intel/phrases';
import { useStore } from './store';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function useFmt() {
  const analysis = useStore((s) => s.analysis);
  const tz = useStore((s) => s.tz);
  return useMemo(
    () => ({
      time: (t: number) => fmtTime(analysis, t, tz),
      day: (t: number) => fmtDay(analysis, t, tz),
      lead: fmtLead,
      /** "05/00" style label used on track markers. */
      short: (t: number) => {
        const d = dateAt(analysis, t, tz);
        return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCHours()).padStart(2, '0')}${tz === 'IST' ? `:${String(d.getUTCMinutes()).padStart(2, '0')}` : ''}`;
      },
      run: () => {
        const d = new Date(analysis);
        return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, 00 UTC`;
      },
      tz,
      analysis,
    }),
    [analysis, tz],
  );
}

export function pct(p: number): string {
  if (p > 0 && p < 0.05) return '<5%';
  return `${Math.round(p * 100)}%`;
}

export function km(x: number): string {
  return `${Math.round(x).toLocaleString('en-IN')} km`;
}
