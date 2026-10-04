// Shareable state in the URL hash: view, season, world seed, run date, event and time.

import { useEffect } from 'react';
import type { SeasonId } from '../engine/climate';
import { useStore, type View } from './store';

const VIEWS: View[] = ['chart', 'memory', 'scenario', 'briefing', 'verify'];
const SEASONS: SeasonId[] = ['postmonsoon', 'monsoon', 'premonsoon', 'winter'];

function parse() {
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const out: { view?: View; season?: SeasonId; seed?: number; analysis?: number; event?: string; t?: number } = {};
  const v = h.get('v');
  if (v && VIEWS.includes(v as View)) out.view = v as View;
  const s = h.get('season');
  if (s && SEASONS.includes(s as SeasonId)) out.season = s as SeasonId;
  const seed = Number(h.get('seed'));
  if (Number.isFinite(seed) && seed > 0) out.seed = seed;
  const d = h.get('date');
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const ms = Date.parse(`${d}T00:00:00Z`);
    if (Number.isFinite(ms)) out.analysis = ms;
  }
  const e = h.get('event');
  if (e) out.event = e;
  const t = Number(h.get('t'));
  if (h.has('t') && Number.isFinite(t)) out.t = t;
  return out;
}

export function useUrlSync() {
  useEffect(() => {
    const p = parse();
    const s = useStore.getState();
    if (p.view) s.setView(p.view);
    // Event and time from the link are applied as soon as the run is ready.
    void s.load({ season: p.season, seed: p.seed, analysis: p.analysis }, { select: p.event, t: p.t });
    let timer = 0;
    const unsub = useStore.subscribe((st) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const d = new Date(st.analysis);
        const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        const q = new URLSearchParams({ v: st.view, season: st.season, seed: String(st.seed), date });
        if (st.selectedId) q.set('event', st.selectedId);
        if (st.t !== 0) q.set('t', String(st.t));
        const next = `#${q.toString()}`;
        if (window.location.hash !== next) window.history.replaceState(null, '', next);
      }, 250);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, []);
}
