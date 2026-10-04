// Scenario Lab: change the environment, re-run the forecast and see what
// changes and why (Shapley attribution over the factors you changed).

import { useMemo, useState } from 'react';
import type { EventTrack } from '../engine/events';
import { catIndex, catName } from '../engine/imd';
import { changedFactors, matchEvent, SCENARIO_FACTORS, SCENARIO_PRESETS, type Attribution } from '../engine/scenario';
import { NEUTRAL_SCENARIO, type ScenarioParams } from '../engine/world';
import { MapView } from '../map/MapView';
import type { MapViewState } from '../map/view';
import { useFmt } from '../state/format';
import { useStore } from '../state/store';
import { rasterFor, useRain24, useThemeKey } from './ChartView';

function fmtParam(key: keyof ScenarioParams, v: number): string {
  const f = SCENARIO_FACTORS.find((x) => x.key === key)!;
  if (f.unit === '×') return `${v.toFixed(2)}×`;
  if (key === 'rhDelta') return `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
  if (key === 'mjo') return v > 0.05 ? `active ${v.toFixed(1)}` : v < -0.05 ? `suppressed ${(-v).toFixed(1)}` : 'neutral';
  if (key === 'brownOcean') return v === 0 ? 'dry' : `${Math.round(v * 100)}%`;
  return `${v >= 0 ? '+' : ''}${v}${f.unit ? ` ${f.unit}` : ''}`;
}

export default function ScenarioView() {
  const run = useStore((s) => s.run);
  const params = useStore((s) => s.scenarioParams);
  const setParams = useStore((s) => s.setScenarioParams);
  const focus = useStore((s) => s.scenarioFocus);
  const setFocus = useStore((s) => s.setScenarioFocus);
  const status = useStore((s) => s.scenarioStatus);
  const runScenario = useStore((s) => s.runScenario);
  const scenarios = useStore((s) => s.scenarios);
  const activeKey = useStore((s) => s.scenarioActive);
  const setActive = useStore((s) => s.setScenarioActive);
  const t = useStore((s) => s.t);
  const layers = useStore((s) => s.layers);
  const fmt = useFmt();
  const themeKey = useThemeKey();
  const [split, setSplit] = useState(false);
  const [view, setView] = useState<MapViewState | null>(null);
  const [label, setLabel] = useState('');
  const rain24 = useRain24(run, layers.raster === 'rain24' ? t : NaN);

  const active = scenarios.find((s) => s.key === activeKey) ?? null;
  const cyclones = (run?.events ?? []).filter((e) => e.kind === 'cyclone' && e.t1 >= 0 && catIndex(e.maxCat) >= 2);
  const base = cyclones.find((e) => e.id === focus) ?? cyclones[0] ?? null;
  const scenEv = useMemo(() => (active && base ? matchEvent(base, active.payload.events) : null), [active, base]);

  if (!run) return null;
  const changed = changedFactors(params);
  const baseField = run.fields[run.times.indexOf(t)] ?? null;
  const scenK = active ? active.payload.times.indexOf(t) : -1;
  const scenField = active && scenK >= 0 ? active.payload.fields[scenK] : baseField;
  const scenRun = active ? { ...run, times: active.payload.times, fields: active.payload.fields } : run;

  const baseGhost = base ? [{ id: `base-${base.id}`, label: 'baseline', points: base.points.filter((p) => p.t >= -24) }] : [];

  return (
    <div className="scenario">
      <aside className="scenario__controls">
        <h2 className="panel-title">Scenario Lab</h2>
        <p className="muted small">Change the environment and re-run the forecast. The scenario reuses the model's own random draws, so every difference comes from what you changed.</p>
        <div className="field">
          <label className="label" htmlFor="sc-focus">
            Focus system
          </label>
          <select id="sc-focus" className="input input--select" value={base?.id ?? ''} onChange={(e) => setFocus(e.target.value)}>
            {cyclones.length === 0 && <option value="">No cyclonic system in this run</option>}
            {cyclones.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ? `${c.name} (${c.label})` : c.label}, {c.maxCat}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <div className="label">Presets</div>
          <div className="presets">
            {SCENARIO_PRESETS.map((p) => (
              <button
                key={p.id}
                className="suggest__chip"
                title={p.note}
                onClick={() => {
                  setParams({ ...NEUTRAL_SCENARIO, ...p.params });
                  setLabel(p.label);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="factors">
          {SCENARIO_FACTORS.map((f) => {
            const v = params[f.key];
            const isChanged = Math.abs(v - f.neutral) > 1e-9;
            return (
              <div key={f.key} className={`factor ${isChanged ? 'factor--changed' : ''}`}>
                <div className="factor__top">
                  <label htmlFor={`f-${f.key}`}>{f.label}</label>
                  <span className="num factor__value">{fmtParam(f.key, v)}</span>
                </div>
                <input id={`f-${f.key}`} className="range" type="range" min={f.min} max={f.max} step={f.step} value={v} onChange={(e) => setParams({ [f.key]: Number(e.target.value) } as Partial<ScenarioParams>)} />
                <div className="factor__hint faint">{f.hint}</div>
              </div>
            );
          })}
        </div>
        <div className="scenario__run">
          <input className="input" value={label} placeholder="Name this scenario" onChange={(e) => setLabel(e.target.value)} aria-label="Scenario name" />
          <div className="scenario__buttons">
            <button className="btn btn--primary" disabled={status === 'running' || changed.length === 0} onClick={() => void runScenario(label || undefined, base?.id ?? null)}>
              {status === 'running' ? 'Running…' : 'Run scenario'}
            </button>
            <button
              className="btn"
              onClick={() => {
                setParams({ ...NEUTRAL_SCENARIO });
                setLabel('');
              }}
            >
              Reset
            </button>
          </div>
          {changed.length === 0 && <p className="faint small">Move at least one slider to run a scenario.</p>}
        </div>
        {scenarios.length > 0 && (
          <div className="field">
            <div className="label">This session</div>
            <ul className="saved">
              {scenarios.map((s) => (
                <li key={s.key}>
                  <button className="menu-item" data-active={s.key === activeKey} onClick={() => setActive(s.key)}>
                    <span>{s.label}</span>
                    <span className="faint small">
                      {changedFactors(s.params)
                        .map((k) => `${SCENARIO_FACTORS.find((f) => f.key === k)!.label.split(' ')[0]} ${fmtParam(k, s.params[k])}`)
                        .join(', ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
      <div className={`scenario__maps ${split && active ? 'scenario__maps--split' : ''}`}>
        {split && active && (
          <div className="scenario__map">
            <MapView
              grid={run.grid}
              raster={rasterFor(run, layers.raster === 'none' ? 'rain6' : layers.raster, t, rain24, null)}
              mslp={baseField?.mslp ?? null}
              wind={null}
              events={run.events}
              t={t}
              selectedId={base?.id}
              view={view}
              onViewChange={setView}
              fmtShort={fmt.short}
              themeKey={themeKey}
              label="Baseline forecast"
              legend={false}
              cities
              warnings={false}
            />
          </div>
        )}
        <div className="scenario__map">
          <MapView
            grid={run.grid}
            raster={rasterFor(scenRun, layers.raster === 'none' || layers.raster === 'rain24' ? 'rain6' : layers.raster, t, null, null)}
            mslp={scenField?.mslp ?? null}
            wind={null}
            events={active ? active.payload.events : run.events}
            t={t}
            selectedId={active ? scenEv?.id : base?.id}
            ghosts={active ? baseGhost : []}
            view={view}
            onViewChange={setView}
            fmtShort={fmt.short}
            themeKey={themeKey}
            label={active ? (split ? active.label : `${active.label}, baseline track dotted`) : 'Baseline forecast'}
            cities
            warnings={false}
          />
        </div>
        {active && (
          <button className="btn scenario__split" onClick={() => setSplit(!split)}>
            {split ? 'Overlay' : 'Side by side'}
          </button>
        )}
      </div>
      <aside className="scenario__results">
        {!active ? (
          <div className="empty-state empty-state--inline">
            <h3>No scenario yet</h3>
            <p className="muted">Pick a preset or move the sliders, then run. Results compare the scenario with the baseline forecast for the focus system and explain which change caused what.</p>
          </div>
        ) : !base ? (
          <p className="muted">Choose a focus system to compare.</p>
        ) : (
          <Results base={base} scen={scenEv} attribution={active.payload.focusTruthId !== null && active.payload.focusTruthId === base.truthId ? active.payload.attribution : null} attributionStale={active.payload.focusTruthId !== base.truthId} />
        )}
      </aside>
    </div>
  );
}

/** The part of an event that a scenario can change: the forecast period. */
function forecastPart(e: EventTrack) {
  const pts = e.points.filter((p) => p.t >= 0);
  const peak = pts.reduce((a, b) => ((b.vmax ?? 0) > (a.vmax ?? 0) ? b : a), pts[0] ?? e.points[e.points.length - 1]);
  const minP = Math.min(...(pts.length ? pts : e.points).map((p) => p.pmin ?? 1010));
  const t0 = Math.max(0, e.t0);
  return { peak, minP, life: Math.max(0, e.t1 - t0), landfall: e.landfall && e.landfall.t >= 0 ? e.landfall : null };
}

function Results({ base, scen, attribution, attributionStale }: { base: EventTrack; scen: EventTrack | null; attribution: Attribution[] | null; attributionStale: boolean }) {
  const fmt = useFmt();
  if (!scen) return <p className="muted">In this scenario the focus system does not develop: it never forms or stays too weak to track.</p>;
  const A = forecastPart(base);
  const B = forecastPart(scen);
  const rows: { label: string; a: string; b: string; d: string }[] = [];
  const pa = A.peak;
  const pb = B.peak;
  rows.push({ label: 'Peak intensity', a: `${Math.round(pa.vmax ?? 0)} kt ${pa.cat}`, b: `${Math.round(pb.vmax ?? 0)} kt ${pb.cat}`, d: signed(Math.round((pb.vmax ?? 0) - (pa.vmax ?? 0)), 'kt') });
  rows.push({ label: 'Lowest pressure', a: `${Math.round(A.minP)} hPa`, b: `${Math.round(B.minP)} hPa`, d: signed(Math.round(B.minP - A.minP), 'hPa') });
  const la = A.landfall;
  const lb = B.landfall;
  rows.push({
    label: 'Landfall',
    a: la ? `${la.place}, ${fmt.short(Math.round(la.t))}` : 'none',
    b: lb ? `${lb.place}, ${fmt.short(Math.round(lb.t))}` : 'none',
    d: la && lb ? `${signed(Math.round(lb.t - la.t), 'h')}` : la || lb ? 'changes' : '',
  });
  if (la && lb) rows.push({ label: 'Landfall wind', a: `${Math.round(la.vmax)} kt`, b: `${Math.round(lb.vmax)} kt`, d: signed(Math.round(lb.vmax - la.vmax), 'kt') });
  rows.push({ label: 'Forecast lifetime', a: `${A.life} h`, b: `${B.life} h`, d: signed(B.life - A.life, 'h') });
  const narrative = narrate(base, scen, attribution);
  return (
    <div className="stack">
      <section>
        <h3 className="section-title">{base.name ?? base.label}: baseline vs scenario</h3>
        <p className="faint small">Forecast period only (from the analysis time onward), which is all a scenario can change.</p>
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>Baseline</th>
              <th>Scenario</th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="muted">{r.label}</td>
                <td className="num">{r.a}</td>
                <td className="num">{r.b}</td>
                <td className="num">{r.d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3 className="section-title">What caused the change</h3>
        <p className="muted small">Exact Shapley values: every combination of your changes was simulated, and each factor gets its fair share of the difference.</p>
        {!attribution ? (
          <p className="muted">{attributionStale ? 'This scenario was run for a different focus system. Run it again to attribute this one.' : 'Attribution needs a focus system that exists in the hidden truth.'}</p>
        ) : (
          attribution.map((a) => <Waterfall key={a.metric} a={a} />)
        )}
      </section>
      {narrative && (
        <section>
          <h3 className="section-title">In words</h3>
          <p className="where">{narrative}</p>
        </section>
      )}
    </div>
  );
}

/** "the Bay of Bengal sea temperature", "vertical wind shear": keep proper nouns capitalised. */
function factorPhrase(label: string): string {
  if (/^(Bay|Arabian|Madden)/.test(label)) return `the ${label}`;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function signed(v: number, unit: string) {
  if (!v) return `0 ${unit}`;
  return `${v > 0 ? '+' : '−'}${Math.abs(v)} ${unit}`;
}

function Waterfall({ a }: { a: Attribution }) {
  if (a.base === null || a.scenario === null) {
    return (
      <div className="wf">
        <div className="wf__title">{a.label}</div>
        <p className="faint small">Not applicable: {a.metric.startsWith('landfall') ? 'the system does not make landfall in every combination' : 'no value'}.</p>
      </div>
    );
  }
  const total = a.scenario - a.base;
  const contribs = a.contributions.filter((c) => Number.isFinite(c.value));
  const maxAbs = Math.max(1e-6, ...contribs.map((c) => Math.abs(c.value)), Math.abs(total));
  const unit = a.unit;
  const fmtV = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v) < 10 ? Math.abs(v).toFixed(1) : Math.round(Math.abs(v))}${unit ? ` ${unit}` : ''}`;
  return (
    <div className="wf">
      <div className="wf__title">
        {a.label}
        <span className="muted num">
          {' '}
          {a.metric === 'landfallArc' ? fmtV(total) + ' along the coast' : `${Math.round(a.base)} to ${Math.round(a.scenario)}${unit ? ` ${unit}` : ''}`}
        </span>
      </div>
      {contribs.map((c) => (
        <div key={c.key} className="wf__row">
          <span className="wf__label">{c.label}</span>
          <span className="wf__bar">
            <span className={c.value >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(c.value) / maxAbs) * 50}%` }} />
          </span>
          <span className="wf__val num">{fmtV(c.value)}</span>
        </div>
      ))}
    </div>
  );
}

function narrate(base: EventTrack, scen: EventTrack, attribution: Attribution[] | null): string {
  const name = base.name ?? base.label;
  const pa = forecastPart(base).peak;
  const pb = forecastPart(scen).peak;
  const la = forecastPart(base).landfall;
  const lb = forecastPart(scen).landfall;
  const dv = Math.round((pb.vmax ?? 0) - (pa.vmax ?? 0));
  const catWords = catName(pb.cat).toLowerCase();
  let s = `In this scenario ${name} peaks at ${Math.round(pb.vmax ?? 0)} kt as ${/^[aeiou]/.test(catWords) ? 'an' : 'a'} ${catWords}${dv ? `, ${Math.abs(dv)} kt ${dv > 0 ? 'stronger' : 'weaker'} than the baseline` : ', the same as the baseline'}.`;
  const peakAttr = attribution?.find((a) => a.metric === 'peak');
  if (peakAttr) {
    const top = [...peakAttr.contributions].filter((c) => Number.isFinite(c.value) && Math.abs(c.value) >= 1).sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
    if (top.length) s += ` Most of that comes from ${factorPhrase(top[0].label)} (${top[0].value > 0 ? '+' : '−'}${Math.abs(Math.round(top[0].value))} kt).`;
  }
  if (la && lb) {
    const arcA = la.arcKm;
    const arcB = lb.arcKm;
    const dt = Math.round(lb.t - la.t);
    const shift = arcA >= 0 && arcB >= 0 ? Math.round(Math.abs(arcB - arcA) / 10) * 10 : null;
    s += ` Landfall ${lb.place === la.place ? `stays near ${lb.place}` : `moves to ${lb.place}${shift ? `, about ${shift} km along the coast` : ''}`}${dt ? `, ${Math.abs(dt)} h ${dt > 0 ? 'later' : 'earlier'}` : ''}.`;
  } else if (la && !lb) s += ' It no longer makes landfall within the forecast window.';
  else if (!la && lb) s += ` It now makes landfall near ${lb.place}.`;
  return s;
}
