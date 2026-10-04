import { useEffect, useRef, useState } from 'react';
import { SEASONS, type SeasonId } from '../engine/climate';
import { useFmt } from '../state/format';
import { useStore, type View } from '../state/store';
import { SHOWCASE } from '../state/showcase';
import { IconChevron, IconCommand, IconMoon, IconShuffle, IconSun, Mark } from '../ui/icons';

const VIEWS: { id: View; label: string; key: string }[] = [
  { id: 'chart', label: 'Chart', key: '1' },
  { id: 'memory', label: 'Memory', key: '2' },
  { id: 'scenario', label: 'Scenario Lab', key: '3' },
  { id: 'briefing', label: 'Briefing', key: '4' },
  { id: 'verify', label: 'Verification', key: '5' },
];

export function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const tz = useStore((s) => s.tz);
  const setTz = useStore((s) => s.setTz);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const reveal = useStore((s) => s.reveal);
  const setReveal = useStore((s) => s.setReveal);
  const setPalette = useStore((s) => s.setPalette);
  const dark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header className="topbar">
      <div className="brand">
        <Mark />
        <span className="brand__name">Trikaal</span>
      </div>
      <RunPicker />
      <nav className="tabs" aria-label="Views">
        {VIEWS.map((v) => (
          <button key={v.id} className="tabs__item" aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)} title={`${v.label} (${v.key})`}>
            {v.label}
          </button>
        ))}
      </nav>
      <div className="topbar__right">
        <JobStatus />
        <label className="toggle" title="Show what actually happened in this synthetic world">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
          Reveal outcome
        </label>
        <div className="seg" role="group" aria-label="Time zone">
          {(['IST', 'UTC'] as const).map((z) => (
            <button key={z} aria-pressed={tz === z} onClick={() => setTz(z)}>
              {z}
            </button>
          ))}
        </div>
        <button className="btn btn--icon btn--ghost" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Use light theme' : 'Use dark theme'} title="Toggle theme">
          {dark ? <IconSun /> : <IconMoon />}
        </button>
        <button className="btn btn--ghost" onClick={() => setPalette(true)} title="Command palette (Ctrl K)">
          <IconCommand />
          <span className="kbd">Ctrl K</span>
        </button>
      </div>
    </header>
  );
}

function RunPicker() {
  const [open, setOpen] = useState(false);
  const fmt = useFmt();
  const season = useStore((s) => s.season);
  const seed = useStore((s) => s.seed);
  const load = useStore((s) => s.load);
  const setSeason = useStore((s) => s.setSeason);
  const newWorld = useStore((s) => s.newWorld);
  const [seedText, setSeedText] = useState(String(seed));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setSeedText(String(seed)), [seed]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="runpicker" ref={ref}>
      <button className="runpicker__button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog">
        <span className="runpicker__run num">Run {fmt.run()}</span>
        <span className="runpicker__meta">
          Synthetic {SEASONS[season].label.toLowerCase()} run, world {seed}
        </span>
        <IconChevron />
      </button>
      {open && (
        <div className="popover runpicker__pop" role="dialog" aria-label="Choose a run">
          <div className="pop-section">
            <div className="label">Season</div>
            <div className="season-grid">
              {(Object.keys(SEASONS) as SeasonId[]).map((s) => (
                <button
                  key={s}
                  className="season-card"
                  aria-pressed={season === s}
                  onClick={() => {
                    setSeason(s);
                    setOpen(false);
                  }}
                >
                  <span className="season-card__name">{SEASONS[s].label}</span>
                  <span className="season-card__months muted">{SEASONS[s].months}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="pop-section">
            <div className="label">World</div>
            <form
              className="seed-row"
              onSubmit={(e) => {
                e.preventDefault();
                const n = parseInt(seedText, 10);
                if (Number.isFinite(n)) {
                  void load({ seed: n });
                  setOpen(false);
                }
              }}
            >
              <input className="input num" value={seedText} onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ''))} aria-label="World seed" />
              <button className="btn" type="submit">
                Load
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  newWorld();
                  setOpen(false);
                }}
              >
                <IconShuffle /> New world
              </button>
            </form>
            <p className="muted small">The same season and seed always produce the same weather, so a run can be shared by its seed.</p>
          </div>
          <div className="pop-section">
            <div className="label">Showcase runs</div>
            <ul className="showcase">
              {SHOWCASE.map((s) => (
                <li key={s.label}>
                  <button
                    className="menu-item"
                    onClick={() => {
                      void load({ season: s.season, seed: s.seed, analysis: s.analysis });
                      setOpen(false);
                    }}
                  >
                    <span className="showcase__name">{s.label}</span>
                    <span className="muted small">{SEASONS[s.season].label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function JobStatus() {
  const runStatus = useStore((s) => s.runStatus);
  const runProgress = useStore((s) => s.runProgress);
  const ens = useStore((s) => s.ensembleStatus);
  const ensP = useStore((s) => s.ensembleProgress);
  const mem = useStore((s) => s.memoryStatus);
  const cyc = useStore((s) => s.cyclesStatus);
  let text = '';
  let p = 1;
  if (runStatus === 'running') {
    text = 'Running the model';
    p = runProgress;
  } else if (ens === 'running') {
    text = `Ensemble ${Math.round(ensP * 21)} of 21`;
    p = ensP;
  } else if (mem === 'running' || cyc === 'running') {
    text = mem === 'running' ? 'Loading Event Memory' : 'Comparing earlier cycles';
    p = 0.6;
  }
  if (!text) return <span className="jobs jobs--done muted">All products ready</span>;
  return (
    <span className="jobs" role="status" aria-live="polite">
      <span>{text}</span>
      <span className="jobs__bar">
        <span style={{ width: `${Math.round(p * 100)}%` }} />
      </span>
    </span>
  );
}
