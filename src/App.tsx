import { lazy, Suspense, useEffect } from 'react';
import { useStore } from './state/store';
import { useUrlSync } from './state/url';
import { TopBar } from './shell/TopBar';
import { Timeline } from './shell/Timeline';
import { CommandPalette } from './shell/CommandPalette';
import { ChartView } from './views/ChartView';

const MemoryView = lazy(() => import('./views/MemoryView'));
const ScenarioView = lazy(() => import('./views/ScenarioView'));
const BriefingView = lazy(() => import('./views/BriefingView'));
const VerifyView = lazy(() => import('./views/VerifyView'));

export function App() {
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.theme);
  const runStatus = useStore((s) => s.runStatus);
  const error = useStore((s) => s.error);
  const run = useStore((s) => s.run);
  const playing = useStore((s) => s.playing);

  useUrlSync();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const s = useStore.getState();
      const last = s.run ? s.run.times[s.run.times.length - 1] : 0;
      if (s.t >= last) s.togglePlay();
      else s.step(6);
    }, 650);
    return () => window.clearInterval(id);
  }, [playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        s.setPalette(!s.paletteOpen);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        s.step(e.shiftKey ? 24 : 6);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        s.step(e.shiftKey ? -24 : -6);
      } else if (e.key === ' ') {
        e.preventDefault();
        s.togglePlay();
      } else if (e.key === 'Escape') {
        if (s.paletteOpen) s.setPalette(false);
        else s.select(null);
      } else if (/^[1-5]$/.test(e.key)) {
        s.setView((['chart', 'memory', 'scenario', 'briefing', 'verify'] as const)[Number(e.key) - 1]);
      } else if (e.key === ']' || e.key === '[') {
        const evs = s.run?.events.filter((x) => x.kind === 'cyclone' || x.kind === 'wd' || x.kind === 'heat' || x.kind === 'cold') ?? [];
        if (!evs.length) return;
        const i = evs.findIndex((x) => x.id === s.selectedId);
        const n = (i + (e.key === ']' ? 1 : -1) + evs.length) % evs.length;
        s.select(evs[n].id);
      } else if (e.key === '0') {
        s.setT(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showTimeline = view === 'chart' || view === 'scenario';

  return (
    <div className={`app app--${view} ${showTimeline ? 'app--with-timeline' : ''}`}>
      <TopBar />
      <main className="app__main">
        {!run && runStatus !== 'error' && <Loading />}
        {runStatus === 'error' && !run && (
          <div className="fatal">
            <h2>The model run failed</h2>
            <p className="muted">{error}</p>
            <button className="btn btn--primary" onClick={() => useStore.getState().load()}>
              Run again
            </button>
          </div>
        )}
        {run && (
          <Suspense fallback={<div className="loading muted">Opening view…</div>}>
            {view === 'chart' && <ChartView />}
            {view === 'memory' && <MemoryView />}
            {view === 'scenario' && <ScenarioView />}
            {view === 'briefing' && <BriefingView />}
            {view === 'verify' && <VerifyView />}
          </Suspense>
        )}
      </main>
      {showTimeline && run && <Timeline />}
      <CommandPalette />
    </div>
  );
}

function Loading() {
  const p = useStore((s) => s.runProgress);
  return (
    <div className="loading" role="status">
      <div className="loading__title">Running the model</div>
      <div className="loading__steps muted">Synthesising fields, detecting and tracking systems</div>
      <div className="jobs__bar jobs__bar--wide">
        <span style={{ width: `${Math.round(p * 100)}%` }} />
      </div>
    </div>
  );
}
