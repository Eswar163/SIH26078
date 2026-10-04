// Application state. One store; the engine runs in workers and results land
// here. Every background result is tagged with the run token it belongs to,
// so switching runs never mixes data from two worlds.

import { create } from 'zustand';
import { representativeDate, seasonForMonth, type SeasonId } from '../engine/climate';
import { cityOutlooks, decisionClock, exposure, type CityOutlook, type Decision, type ExposureRow } from '../engine/decision';
import { ENS_GRID, type RunConfig } from '../engine/run';
import { NEUTRAL_SCENARIO, type ScenarioParams } from '../engine/world';
import { catIndex } from '../engine/imd';
import { engine } from '../worker/client';
import type { CyclesPayload, EnsemblePayload, MemoryPayload, RunPayload, ScenarioPayload } from '../worker/protocol';

export type View = 'chart' | 'memory' | 'scenario' | 'briefing' | 'verify';
export type Status = 'idle' | 'running' | 'ready' | 'error';
export type RasterLayer = 'none' | 'rain6' | 'rain24' | 't2m' | 'tmax' | 'wind' | 'sst' | 'shear';
export type ProbLayer = 'none' | 'strike' | 'rain' | 'gale' | 'genesis' | 'heat' | 'cold';
export type WindLayer = 'off' | 'flow' | 'barbs';
export type Theme = 'system' | 'light' | 'dark';
export type DossierTab = 'overview' | 'forecast' | 'dna' | 'lineage';

export interface Layers {
  raster: RasterLayer;
  isobars: boolean;
  z500: boolean;
  wind: WindLayer;
  prob: ProbLayer;
  cities: boolean;
  warnings: boolean;
  spaghetti: boolean;
  ellipses: boolean;
  analogs: boolean;
  cycles: boolean;
  regions: boolean;
}

export interface Derived {
  outlooks: CityOutlook[];
  decisions: Decision[];
  exposure: ExposureRow[];
}

export interface ScenarioEntry {
  key: string;
  label: string;
  params: ScenarioParams;
  payload: ScenarioPayload;
}

interface State {
  season: SeasonId;
  seed: number;
  analysis: number;
  tz: 'UTC' | 'IST';
  theme: Theme;
  view: View;
  token: number;

  run: RunPayload | null;
  runStatus: Status;
  runProgress: number;
  error: string | null;
  ensemble: EnsemblePayload | null;
  ensembleStatus: Status;
  ensembleProgress: number;
  cycles: CyclesPayload | null;
  cyclesStatus: Status;
  memory: MemoryPayload | null;
  memoryStatus: Status;
  derived: Derived | null;

  t: number;
  playing: boolean;
  selectedId: string | null;
  hoverId: string | null;
  layers: Layers;
  reveal: boolean;
  dossierTab: DossierTab;
  memorySel: string | null;
  paletteOpen: boolean;
  focusCity: string | null;

  scenarioParams: ScenarioParams;
  scenarioFocus: string | null;
  scenarioStatus: Status;
  scenarios: ScenarioEntry[];
  scenarioActive: string | null;

  load: (cfg?: Partial<RunConfig>, opts?: { select?: string; t?: number }) => Promise<void>;
  newWorld: () => void;
  setSeason: (s: SeasonId) => void;
  setT: (t: number) => void;
  step: (hours: number) => void;
  togglePlay: () => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setLayer: <K extends keyof Layers>(key: K, value: Layers[K]) => void;
  setView: (v: View) => void;
  setTz: (tz: 'UTC' | 'IST') => void;
  setTheme: (t: Theme) => void;
  setReveal: (b: boolean) => void;
  setDossierTab: (t: DossierTab) => void;
  setMemorySel: (id: string | null) => void;
  setPalette: (b: boolean) => void;
  setFocusCity: (id: string | null) => void;
  setScenarioParams: (p: Partial<ScenarioParams>) => void;
  setScenarioFocus: (id: string | null) => void;
  runScenario: (label?: string, focusId?: string | null) => Promise<void>;
  pendingAsk: string | null;
  setPendingAsk: (q: string | null) => void;
  setScenarioActive: (key: string | null) => void;
}

export function todayConfig(): RunConfig {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  return { season: seasonForMonth(m), seed: y * 10000 + (m + 1) * 100 + d, analysis: Date.UTC(y, m, d, 0) };
}

const DEFAULT_LAYERS: Layers = {
  raster: 'rain6',
  isobars: true,
  z500: false,
  wind: 'flow',
  prob: 'none',
  cities: true,
  warnings: true,
  spaghetti: false,
  ellipses: true,
  analogs: false,
  cycles: false,
  regions: true,
};

function readPrefs(): { theme: Theme; tz: 'UTC' | 'IST' } {
  try {
    const raw = localStorage.getItem('trikaal:prefs');
    if (raw) {
      const p = JSON.parse(raw);
      return { theme: p.theme ?? 'system', tz: p.tz ?? 'IST' };
    }
  } catch {
    /* storage unavailable */
  }
  return { theme: 'system', tz: 'IST' };
}

function writePrefs(theme: Theme, tz: 'UTC' | 'IST') {
  try {
    localStorage.setItem('trikaal:prefs', JSON.stringify({ theme, tz }));
  } catch {
    /* storage unavailable */
  }
}

function defaultSelection(run: RunPayload): string | null {
  const live = run.events.filter((e) => e.t1 >= 0);
  const cyc = live.filter((e) => e.kind === 'cyclone').sort((a, b) => catIndex(b.maxCat) - catIndex(a.maxCat) || a.t0 - b.t0);
  if (cyc.length) return cyc[0].id;
  const order = ['heat', 'cold', 'wd', 'rain', 'storm'];
  for (const k of order) {
    const e = live.find((x) => x.kind === k);
    if (e) return e.id;
  }
  return null;
}

export function computeDerived(run: RunPayload, ens: EnsemblePayload | null): Derived {
  const outlooks = cityOutlooks({
    cones: ens?.cones ?? [],
    ens: ens ? { ...ens.products, byEvent: ens.byEvent, unmatched: ens.unmatched } : null,
    ensGrid: ENS_GRID,
    det: { fields: run.fields, times: run.times, grid: run.grid, statics: run.statics },
  });
  const decisions = decisionClock(outlooks, ens?.cones ?? [], ens?.products.members ?? 21);
  return { outlooks, decisions, exposure: exposure(outlooks) };
}

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

const prefs = readPrefs();
applyTheme(prefs.theme);
const initial = todayConfig();

export const useStore = create<State>((set, get) => ({
  season: initial.season,
  seed: initial.seed,
  analysis: initial.analysis,
  tz: prefs.tz,
  theme: prefs.theme,
  view: 'chart',
  token: 0,

  run: null,
  runStatus: 'idle',
  runProgress: 0,
  error: null,
  ensemble: null,
  ensembleStatus: 'idle',
  ensembleProgress: 0,
  cycles: null,
  cyclesStatus: 'idle',
  memory: null,
  memoryStatus: 'idle',
  derived: null,

  t: 0,
  playing: false,
  selectedId: null,
  hoverId: null,
  layers: DEFAULT_LAYERS,
  reveal: false,
  dossierTab: 'overview',
  memorySel: null,
  paletteOpen: false,
  focusCity: null,

  scenarioParams: { ...NEUTRAL_SCENARIO },
  scenarioFocus: null,
  scenarioStatus: 'idle',
  scenarios: [],
  scenarioActive: null,

  async load(cfg, opts) {
    const s = get();
    const config: RunConfig = {
      season: cfg?.season ?? s.season,
      seed: cfg?.seed ?? s.seed,
      analysis: cfg?.analysis ?? s.analysis,
    };
    // Event ids are per-run counters: keep the selection only when reloading the same world.
    const sameWorld = !!s.run && config.season === s.run.config.season && config.seed === s.run.config.seed && config.analysis === s.run.config.analysis;
    const token = s.token + 1;
    const mem = s.memory;
    set({
      ...config,
      token,
      runStatus: 'running',
      runProgress: 0,
      error: null,
      ensemble: null,
      ensembleStatus: 'idle',
      ensembleProgress: 0,
      cycles: null,
      cyclesStatus: 'idle',
      // The archive and RI model do not depend on the run; analogs, novelty and RI predictions do.
      memory: mem ? { ...mem, analogs: {}, novelty: {}, ri: {} } : null,
      memoryStatus: mem ? 'running' : 'idle',
      derived: null,
      playing: false,
      scenarios: [],
      scenarioActive: null,
      scenarioStatus: 'idle',
    });
    const live = () => get().token === token;
    let run: RunPayload;
    try {
      run = await engine().run(config, (_stage, done, total) => live() && set({ runProgress: done / total }));
    } catch (err) {
      if (live()) set({ runStatus: get().run ? 'ready' : 'error', error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!live()) return;
    const keep = sameWorld && s.selectedId && run.events.some((e) => e.id === s.selectedId) ? s.selectedId : null;
    const wanted = opts?.select && run.events.some((e) => e.id === opts.select) ? opts.select : null;
    const sel = wanted ?? keep ?? defaultSelection(run);
    const focus = run.events.find((e) => e.id === sel && e.kind === 'cyclone') ? sel : defaultSelection(run);
    const t0 = opts?.t !== undefined && Number.isFinite(opts.t) ? Math.max(run.times[0], Math.min(run.times[run.times.length - 1], Math.round(opts.t / 6) * 6)) : 0;
    set({ run, runStatus: 'ready', t: t0, selectedId: sel, scenarioFocus: focus, derived: computeDerived(run, null) });

    set({ ensembleStatus: 'running', cyclesStatus: 'running', memoryStatus: 'running' });
    const fail = (err: unknown) => (err instanceof Error ? err.message : String(err));
    const ensP = engine()
      .ensemble(config, (_s, done, total) => live() && set({ ensembleProgress: done / total }))
      .then((ens) => {
        if (live()) set({ ensemble: ens, ensembleStatus: 'ready', derived: computeDerived(run, ens) });
      })
      .catch((err) => {
        if (live()) set({ ensembleStatus: 'error', error: fail(err) });
      });
    const cycP = engine()
      .cycles()
      .then((c) => {
        if (live()) set({ cycles: c, cyclesStatus: 'ready' });
      })
      .catch((err) => {
        if (live()) set({ cyclesStatus: 'error', error: fail(err) });
      });
    const memP = engine()
      .memory()
      .then((m) => {
        if (live()) set({ memory: m, memoryStatus: 'ready' });
      })
      .catch((err) => {
        if (live()) set({ memoryStatus: 'error', error: fail(err) });
      });
    await Promise.all([ensP, cycP, memP]);
    // Cone coverage in the verification needs the cones: refresh the cycles once the ensemble is in.
    if (live() && get().ensembleStatus === 'ready') {
      try {
        const c = await engine().cycles();
        if (live()) set({ cycles: c });
      } catch {
        /* keep the earlier verification */
      }
    }
  },

  newWorld() {
    const seed = Math.floor(Math.random() * 9_000_000) + 1_000_000;
    void get().load({ seed });
  },

  setSeason(season) {
    const cfg = todayConfig();
    const analysis = cfg.season === season ? cfg.analysis : representativeDate(season, new Date().getUTCFullYear());
    set({ selectedId: null });
    void get().load({ season, analysis, seed: get().seed });
  },

  setT(t) {
    const run = get().run;
    if (!run) return;
    const lo = run.times[0];
    const hi = run.times[run.times.length - 1];
    set({ t: Math.max(lo, Math.min(hi, Math.round(t / 6) * 6)) });
  },
  step(h) {
    get().setT(get().t + h);
  },
  togglePlay() {
    const run = get().run;
    if (!run) return;
    if (!get().playing && get().t >= run.times[run.times.length - 1]) set({ t: run.times[0] });
    set({ playing: !get().playing });
  },
  select(id) {
    set({ selectedId: id });
    // Only cyclonic systems can be a Scenario Lab focus.
    if (id && get().run?.events.some((e) => e.id === id && e.kind === 'cyclone')) set({ scenarioFocus: id });
  },
  hover(id) {
    if (get().hoverId !== id) set({ hoverId: id });
  },
  setLayer(key, value) {
    set({ layers: { ...get().layers, [key]: value } });
  },
  setView(view) {
    set({ view });
  },
  setTz(tz) {
    set({ tz });
    writePrefs(get().theme, tz);
  },
  setTheme(theme) {
    // Apply before React re-renders so the map reads the new colours.
    applyTheme(theme);
    set({ theme });
    writePrefs(theme, get().tz);
  },
  setReveal(reveal) {
    set({ reveal });
  },
  setDossierTab(dossierTab) {
    set({ dossierTab });
  },
  setMemorySel(memorySel) {
    set({ memorySel });
  },
  setPalette(paletteOpen) {
    set({ paletteOpen });
  },
  setFocusCity(focusCity) {
    set({ focusCity });
  },
  setScenarioParams(p) {
    set({ scenarioParams: { ...get().scenarioParams, ...p } });
  },
  setScenarioFocus(scenarioFocus) {
    set({ scenarioFocus });
  },
  async runScenario(label, focusId) {
    const s = get();
    const token = s.token;
    set({ scenarioStatus: 'running' });
    try {
      const payload = await engine().scenario(s.scenarioParams, focusId ?? s.scenarioFocus);
      if (get().token !== token) return;
      const entry: ScenarioEntry = { key: payload.key, label: label ?? `Scenario ${get().scenarios.length + 1}`, params: payload.params, payload };
      const rest = get().scenarios.filter((x) => x.key !== entry.key);
      set({ scenarios: [entry, ...rest].slice(0, 6), scenarioActive: entry.key, scenarioStatus: 'ready' });
    } catch (err) {
      set({ scenarioStatus: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },
  setScenarioActive(scenarioActive) {
    set({ scenarioActive });
  },
  pendingAsk: null,
  setPendingAsk(pendingAsk) {
    set({ pendingAsk });
  },
}));
