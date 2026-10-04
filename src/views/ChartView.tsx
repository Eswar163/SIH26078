import { useEffect, useMemo, useState } from 'react';
import { sample } from '../engine/grid';
import { compass16 } from '../engine/geo';
import { RAMPS } from '../map/palettes';
import { MapView, type RasterSpec } from '../map/MapView';
import { useFmt } from '../state/format';
import { useAnalogs } from '../state/intel';
import { useStore, type Layers, type ProbLayer, type RasterLayer } from '../state/store';
import { Roster } from '../shell/Roster';
import { Dossier } from './Dossier';
import { StoryCaption } from './StoryCaption';
import { IconLayers, IconClose } from '../ui/icons';
import type { RunPayload, EnsemblePayload } from '../worker/protocol';

export function useRain24(run: RunPayload | null, t: number): Float32Array | null {
  return useMemo(() => {
    if (!run) return null;
    const out = new Float32Array(run.grid.nx * run.grid.ny);
    let n = 0;
    for (let h = t - 18; h <= t; h += 6) {
      const k = run.times.indexOf(h);
      if (k < 0) continue;
      const f = run.fields[k].rain6;
      for (let i = 0; i < out.length; i++) out[i] += f[i];
      n++;
    }
    // Only a full 24 h window is a 24 h total.
    return n === 4 ? out : null;
  }, [run, t]);
}

export function rasterFor(run: RunPayload, layer: RasterLayer, t: number, rain24: Float32Array | null, windSpeed: Float32Array | null): RasterSpec | null {
  const k = run.times.indexOf(t);
  if (k < 0) return null;
  const f = run.fields[k];
  const g = run.grid;
  switch (layer) {
    case 'rain6':
      return { grid: g, data: f.rain6, ramp: RAMPS.rain6 };
    case 'rain24':
      return rain24 ? { grid: g, data: rain24, ramp: RAMPS.rain24 } : null;
    case 't2m':
      return { grid: g, data: f.t2m, ramp: RAMPS.t2m };
    case 'tmax':
      return { grid: g, data: f.tmax, ramp: RAMPS.tmax };
    case 'wind':
      return windSpeed ? { grid: g, data: windSpeed, ramp: RAMPS.wind } : null;
    case 'sst':
      return { grid: g, data: run.statics.sst, ramp: RAMPS.sst, mask: run.statics.landFrac, maskMode: 'sea' };
    case 'shear':
      return { grid: g, data: run.statics.shear, ramp: RAMPS.shear, alpha: 0.85 };
    default:
      return null;
  }
}

export function probFor(ens: EnsemblePayload | null, layer: ProbLayer, t: number, selectedId: string | null): RasterSpec | null {
  if (!ens || layer === 'none') return null;
  const day = Math.max(1, Math.min(7, Math.ceil(Math.max(1, t) / 24)));
  const g = ens.grid;
  switch (layer) {
    case 'strike': {
      const cones = ens.cones.filter((c) => !selectedId || c.eventId === selectedId);
      const list = cones.length ? cones : ens.cones;
      if (!list.length) return null;
      if (list.length === 1) return { grid: g, data: list[0].strike, ramp: RAMPS.strike };
      const out = new Float32Array(g.nx * g.ny);
      for (const c of list) for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], c.strike[i]);
      return { grid: g, data: out, ramp: RAMPS.strike };
    }
    case 'rain':
      return ens.products.rainHeavy[day - 1] ? { grid: g, data: ens.products.rainHeavy[day - 1], ramp: RAMPS.probRain } : null;
    case 'gale':
      return { grid: g, data: ens.products.gale, ramp: RAMPS.probGale };
    case 'genesis':
      return { grid: g, data: ens.products.genesis, ramp: RAMPS.genesis };
    case 'heat':
      return ens.products.heat[day - 1] ? { grid: g, data: ens.products.heat[day - 1], ramp: RAMPS.probHeat } : null;
    case 'cold':
      return ens.products.cold[day - 1] ? { grid: g, data: ens.products.cold[day - 1], ramp: RAMPS.probCold } : null;
  }
  return null;
}

export function useThemeKey() {
  const theme = useStore((s) => s.theme);
  const [sys, setSys] = useState(() => (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSys(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return `${theme}:${sys}`;
}

export function ChartView() {
  const run = useStore((s) => s.run);
  const ensemble = useStore((s) => s.ensemble);
  const cycles = useStore((s) => s.cycles);
  const derived = useStore((s) => s.derived);
  const t = useStore((s) => s.t);
  const layers = useStore((s) => s.layers);
  const selectedId = useStore((s) => s.selectedId);
  const hoverId = useStore((s) => s.hoverId);
  const select = useStore((s) => s.select);
  const hover = useStore((s) => s.hover);
  const reveal = useStore((s) => s.reveal);
  const focusCity = useStore((s) => s.focusCity);
  const fmt = useFmt();
  const themeKey = useThemeKey();
  const rain24 = useRain24(run, layers.raster === 'rain24' ? t : NaN);
  const analogs = useAnalogs(layers.analogs ? selectedId : null);
  const field = run ? run.fields[run.times.indexOf(t)] ?? null : null;
  const windSpeed = useMemo(() => {
    if (!field || layers.raster !== 'wind') return null;
    const out = new Float32Array(field.u10.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.hypot(field.u10[i], field.v10[i]) * 1.943844;
    return out;
  }, [field, layers.raster]);

  const cone = ensemble?.cones.find((c) => c.eventId === selectedId) ?? null;
  const spaghetti = layers.spaghetti && selectedId && ensemble ? ensemble.byEvent[selectedId] ?? null : null;
  const cycleTracks = useMemo(() => {
    if (!layers.cycles || !selectedId || !cycles?.trends[selectedId]) return [];
    return cycles.trends[selectedId].runs.filter((r) => r.init !== 0).map((r) => ({ init: r.init, label: `${-r.init} h earlier`, points: r.points }));
  }, [layers.cycles, selectedId, cycles]);
  const truth = useMemo(() => {
    if (!reveal || !run) return [];
    const ids = new Set(run.events.filter((e) => e.kind === 'cyclone' && e.truthId !== undefined).map((e) => e.truthId!));
    return run.truth.filter((x) => x.kind === 'cyclone' && (ids.has(x.id) || Math.max(...x.v) >= 17)).map((x) => ({ id: x.id, points: x.t.map((tt, i) => ({ t: tt, lon: x.lon[i], lat: x.lat[i] })) }));
  }, [reveal, run]);
  const ghosts = analogs.slice(0, 5).map((a) => ({ id: a.event.id, label: a.event.name ?? a.event.label, points: a.event.points }));

  if (!run) return null;
  const probe = (lon: number, lat: number) => {
    if (!field) return [];
    const g = run.grid;
    const u = sample(g, field.u10, lon, lat);
    const v = sample(g, field.v10, lon, lat);
    const spd = Math.hypot(u, v) * 1.943844;
    const from = (Math.atan2(-u, -v) * 180) / Math.PI;
    return [
      { label: 'Pressure', value: `${sample(g, field.mslp, lon, lat).toFixed(1)} hPa` },
      { label: 'Wind', value: `${Math.round(spd)} kt from ${compass16((from + 360) % 360)}` },
      { label: 'Rain 6 h', value: `${Math.max(0, sample(g, field.rain6, lon, lat)).toFixed(1)} mm` },
      { label: 'Temp', value: `${sample(g, field.t2m, lon, lat).toFixed(1)} °C` },
    ];
  };

  return (
    <div className="chartview">
      <Roster />
      <div className="chartview__map">
        <MapView
          grid={run.grid}
          raster={rasterFor(run, layers.raster, t, rain24, windSpeed)}
          prob={probFor(ensemble, layers.prob, t, selectedId)}
          mslp={layers.isobars && field ? field.mslp : null}
          z500={layers.z500 && field ? field.z500 : null}
          wind={field ? { u: field.u10, v: field.v10, mode: layers.wind } : null}
          events={run.events}
          t={t}
          selectedId={selectedId}
          hoverId={hoverId}
          regions={layers.regions}
          cone={cone}
          ellipses={layers.ellipses}
          spaghetti={spaghetti}
          ghosts={ghosts}
          cycleTracks={cycleTracks}
          truth={truth}
          cities={layers.cities}
          warnings={layers.warnings}
          outlooks={derived?.outlooks ?? null}
          focusCity={focusCity}
          onSelect={select}
          onHover={hover}
          probe={probe}
          fmtShort={fmt.short}
          themeKey={themeKey}
        />
        <LayerPanel />
        <StoryCaption />
      </div>
      <Dossier />
    </div>
  );
}

const RASTERS: { id: RasterLayer; label: string }[] = [
  { id: 'rain6', label: 'Rain, 6 h' },
  { id: 'rain24', label: 'Rain, 24 h' },
  { id: 'wind', label: 'Wind speed' },
  { id: 't2m', label: 'Temperature' },
  { id: 'tmax', label: 'Max temperature' },
  { id: 'sst', label: 'Sea temperature' },
  { id: 'shear', label: 'Wind shear' },
  { id: 'none', label: 'None' },
];

const PROBS: { id: ProbLayer; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'strike', label: 'Strike probability' },
  { id: 'gale', label: 'Gale-force wind' },
  { id: 'rain', label: 'Heavy rain, by day' },
  { id: 'heat', label: 'Heat wave, by day' },
  { id: 'cold', label: 'Cold wave, by day' },
  { id: 'genesis', label: 'New depression' },
];

export function LayerPanel() {
  const layers = useStore((s) => s.layers);
  const setLayer = useStore((s) => s.setLayer);
  const ensReady = useStore((s) => s.ensembleStatus === 'ready');
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.innerHeight > 860 && window.innerWidth > 1500);
  const toggle = (key: keyof Layers, label: string) => (
    <label className="toggle">
      <input type="checkbox" checked={layers[key] as boolean} onChange={(e) => setLayer(key, e.target.checked as never)} />
      {label}
    </label>
  );
  if (!open) {
    return (
      <button className="btn layer-fab" onClick={() => setOpen(true)} onPointerDown={(e) => e.stopPropagation()}>
        <IconLayers /> Layers
      </button>
    );
  }
  return (
    <div className="layerpanel" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="layerpanel__head">
        <span className="panel-title">Layers</span>
        <button className="btn btn--icon btn--ghost" onClick={() => setOpen(false)} aria-label="Hide layers">
          <IconClose />
        </button>
      </div>
      <div className="layerpanel__group">
        <div className="label">Field</div>
        <select className="input input--select" value={layers.raster} onChange={(e) => setLayer('raster', e.target.value as RasterLayer)}>
          {RASTERS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="layerpanel__group">
        <div className="label">Ensemble probability</div>
        <select className="input input--select" value={layers.prob} disabled={!ensReady} onChange={(e) => setLayer('prob', e.target.value as ProbLayer)}>
          {PROBS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="layerpanel__group">
        <div className="label">Wind</div>
        <div className="seg">
          {(['off', 'flow', 'barbs'] as const).map((m) => (
            <button key={m} aria-pressed={layers.wind === m} onClick={() => setLayer('wind', m)}>
              {m === 'off' ? 'Off' : m === 'flow' ? 'Flow' : 'Barbs'}
            </button>
          ))}
        </div>
      </div>
      <div className="layerpanel__group layerpanel__toggles">
        {toggle('isobars', 'Isobars')}
        {toggle('z500', '500 hPa height')}
        {toggle('regions', 'Event outlines')}
        {toggle('cities', 'Cities')}
        {toggle('warnings', 'Warning colours')}
      </div>
      <div className="layerpanel__group layerpanel__toggles">
        <div className="label">Selected cyclone</div>
        {toggle('ellipses', 'Uncertainty ellipses')}
        {toggle('spaghetti', 'Ensemble members')}
        {toggle('cycles', 'Earlier cycles')}
        {toggle('analogs', 'Relatives from memory')}
      </div>
    </div>
  );
}
