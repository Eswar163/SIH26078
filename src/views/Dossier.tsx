// The event dossier: everything known about the selected event, in four tabs.

import { useMemo } from 'react';
import type { Cone } from '../engine/cone';
import type { EventTrack } from '../engine/events';
import { catIndex, catName, KT_TO_KMH, WARN_LEVELS } from '../engine/imd';
import { motionPhrase, systemNoun, whereIs, capitalise, titleOf } from '../engine/intel/phrases';
import { isLandPoint } from '../engine/land';
import { coastPosition } from '../engine/places';
import { distKm } from '../engine/geo';
import { RI_FEATURES } from '../engine/ri';
import type { TruthTrack } from '../engine/run';
import { CoastRibbon } from '../charts/CoastRibbon';
import { DnaStrip, GenomeBars } from '../charts/DnaStrip';
import { LifecycleChart } from '../charts/LifecycleChart';
import { familyOf, LineageChart, RELATION_WORDS } from '../charts/Lineage';
import { useFmt, pct } from '../state/format';
import { useAnalogs } from '../state/intel';
import { useStore, type DossierTab } from '../state/store';
import { IconClose } from '../ui/icons';
import { CatChip, KindGlyph } from '../ui/kind';

const TABS: { id: DossierTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'dna', label: 'DNA' },
  { id: 'lineage', label: 'Lineage' },
];

export function Dossier() {
  const run = useStore((s) => s.run);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const tab = useStore((s) => s.dossierTab);
  const setTab = useStore((s) => s.setDossierTab);
  const t = useStore((s) => s.t);
  const ensemble = useStore((s) => s.ensemble);
  const ev = run?.events.find((e) => e.id === selectedId) ?? null;
  const fmt = useFmt();

  if (!run) return <aside className="dossier" />;
  if (!ev) {
    return (
      <aside className="dossier dossier--empty">
        <div className="empty-state">
          <h2>No event selected</h2>
          <p className="muted">Choose an event in the list, on the map or on the timeline to see its lifecycle, forecast, DNA and family.</p>
        </div>
      </aside>
    );
  }
  const idx = ev.points.findIndex((p) => p.t === t);
  const i = idx >= 0 ? idx : t < ev.t0 ? 0 : ev.points.length - 1;
  const p = ev.points[i];
  const cone = ensemble?.cones.find((c) => c.eventId === ev.id) ?? null;

  return (
    <aside className="dossier" aria-label="Event dossier">
      <header className="dossier__head">
        <div className="dossier__kicker">
          <KindGlyph kind={ev.kind} cat={p.cat} />
          <span>{capitalise(systemNoun(ev, p))}</span>
          {idx < 0 && <span className="faint">{t < ev.t0 ? `forms ${fmt.time(ev.t0)}` : `ended ${fmt.time(ev.t1)}`}</span>}
        </div>
        <h2 className="dossier__title">{ev.kind === 'cyclone' && ev.name ? ev.name : ev.label}</h2>
        <div className="dossier__sub muted">
          {ev.kind === 'cyclone' && ev.name && <span>{ev.label}</span>}
          {ev.kind === 'cyclone' && !ev.name && ev.pendingName && <span>Next name on the list: {ev.pendingName}</span>}
          <span className="num">
            {fmt.time(ev.t0)} to {fmt.time(ev.t1)}
          </span>
        </div>
        <button className="btn btn--icon btn--ghost dossier__close" onClick={() => select(null)} aria-label="Close dossier">
          <IconClose />
        </button>
        <nav className="dossier__tabs" role="tablist">
          {TABS.map((tb) => (
            <button key={tb.id} role="tab" aria-selected={tab === tb.id} onClick={() => setTab(tb.id)}>
              {tb.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="dossier__body">
        {tab === 'overview' && <Overview ev={ev} i={i} cone={cone} />}
        {tab === 'forecast' && <Forecast ev={ev} cone={cone} />}
        {tab === 'dna' && <DnaTab ev={ev} />}
        {tab === 'lineage' && <LineageTab ev={ev} />}
      </div>
    </aside>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="fig">
      <div className="fig__label">{label}</div>
      <div className="fig__value num">{value}</div>
      {sub && <div className="fig__sub muted num">{sub}</div>}
    </div>
  );
}

function Overview({ ev, i, cone }: { ev: EventTrack; i: number; cone: Cone | null }) {
  const t = useStore((s) => s.t);
  const setT = useStore((s) => s.setT);
  const memory = useStore((s) => s.memory);
  const reveal = useStore((s) => s.reveal);
  const run = useStore((s) => s.run);
  const fmt = useFmt();
  const p = ev.points[i];
  const truth = reveal && ev.truthId !== undefined ? run?.truth.find((x) => x.id === ev.truthId && x.kind === ev.kind) : null;
  const ri = memory?.ri[ev.id]?.[i] ?? null;
  const model = memory?.riModel;
  return (
    <div className="stack">
      <section className="figs">
        {ev.kind === 'cyclone' && (
          <>
            <Figure label="Max wind" value={`${Math.round(p.vmax ?? 0)} kt`} sub={`${Math.round((p.vmax ?? 0) * KT_TO_KMH)} km/h`} />
            <Figure label="Central pressure" value={`${Math.round(p.pmin ?? 0)} hPa`} sub={`${p.closed ?? 0} closed isobars`} />
            <Figure label="Movement" value={ev.speed[i] < 4 ? 'Stationary' : `${Math.round(ev.speed[i])} km/h`} sub={ev.speed[i] < 4 ? undefined : motionPhrase(ev, i).replace(/^moving /, '').replace(/ at .*/, '')} />
            <Figure label="Outer closed isobar" value={`${Math.round(p.roci ?? 0)} km`} sub={p.r34 ? `34 kt radius ${Math.round(p.r34)} km` : 'No gale radius'} />
          </>
        )}
        {ev.kind === 'wd' && (
          <>
            <Figure label="Trough depth" value={`${Math.round(p.amp ?? 0)} gpm`} sub={p.cat} />
            <Figure label="Movement" value={`${Math.round(ev.speed[i])} km/h`} />
            <Figure label="Precipitation" value={`${Math.round(p.rainMax ?? 0)} mm`} sub="peak, 6 h" />
          </>
        )}
        {(ev.kind === 'heat' || ev.kind === 'cold') && (
          <>
            <Figure label={ev.kind === 'heat' ? 'Hottest' : 'Coldest night'} value={`${(p.peak ?? 0).toFixed(1)} °C`} />
            <Figure label="Departure" value={`${(p.mean ?? 0) > 0 ? '+' : ''}${(p.mean ?? 0).toFixed(1)} °C`} sub="mean over area" />
            <Figure label="Area" value={`${Math.round((p.area ?? 0) / 1000).toLocaleString('en-IN')}k km²`} />
            <Figure label="Severe share" value={pct(p.severeFrac ?? 0)} />
          </>
        )}
        {(ev.kind === 'rain' || ev.kind === 'storm') && (
          <>
            <Figure label="Peak" value={`${Math.round(p.peak ?? 0)} mm`} sub={ev.kind === 'rain' ? 'in 24 h' : 'in 6 h'} />
            <Figure label="Area" value={`${Math.round((p.area ?? 0) / 1000).toLocaleString('en-IN')}k km²`} />
            <Figure label="Over land" value={pct(p.landFrac ?? 0)} />
          </>
        )}
      </section>
      <p className="where">{capitalise(whereIs(p))}.</p>
      <section>
        <h3 className="section-title">Lifecycle</h3>
        <LifecycleChart ev={ev} t={t} cone={cone} truth={truth ? { t: truth.t, v: truth.v } : null} fmtDay={fmt.day} onSetT={setT} />
      </section>
      <section>
        <h3 className="section-title">Milestones</h3>
        <ol className="milestones">
          {ev.milestones.map((m, k) => (
            <li key={k}>
              <button className="milestone" onClick={() => setT(Math.round(m.t / 6) * 6)} aria-current={Math.round(m.t / 6) * 6 === t ? 'true' : undefined}>
                <span className="milestone__time num">{fmt.time(Math.round(m.t))}</span>
                <span className={`milestone__dot milestone__dot--${m.type}`} />
                <span className="milestone__label">{m.label}</span>
                {m.t > 0 && <span className="milestone__fc faint">forecast</span>}
              </button>
            </li>
          ))}
        </ol>
      </section>
      {ev.kind === 'cyclone' && (
        <section>
          <h3 className="section-title">Rapid intensification</h3>
          {!model ? (
            <p className="muted">The model trains on Event Memory once it has loaded.</p>
          ) : !ri ? (
            <p className="muted">Not applicable at this point: the system is over land or below 20 kt.</p>
          ) : (
            <div className="ri">
              <div className="ri__head">
                <span className="ri__p num">{pct(ri.probability)}</span>
                <span className="muted">chance of +30 kt in the next 24 h. Usual rate {pct(model.climatology)}.</span>
              </div>
              <div className="ri__scale">
                <span className="ri__fill" style={{ width: `${Math.min(100, ri.probability * 100)}%` }} />
                <span className="ri__clim" style={{ left: `${model.climatology * 100}%` }} title="Climatology" />
              </div>
              <ul className="ri__drivers">
                {ri.contributions.slice(0, 5).map((c) => (
                  <li key={c.feature}>
                    <span>{c.feature}</span>
                    <span className="num muted">{fmtFeature(c.feature, c.value)}</span>
                    <span className="ri__bar">
                      <span className={c.effect >= 0 ? 'up' : 'down'} style={{ width: `${Math.min(50, Math.abs(c.effect) * 22)}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="faint small">
                Logistic model trained in your browser on {model.samples.toLocaleString('en-IN')} archive points. Held-out AUC {model.auc.toFixed(2)}, Brier {model.brier.toFixed(3)}.
              </p>
            </div>
          )}
        </section>
      )}
      {ev.kind === 'cyclone' && ev.env && (
        <section>
          <h3 className="section-title">Environment at {fmt.time(p.t)}</h3>
          <div className="figs figs--3">
            <Figure label="Sea temperature" value={`${ev.env.sst[i].toFixed(1)} °C`} sub={ev.env.sst[i] >= 28.5 ? 'very warm' : ev.env.sst[i] >= 26.5 ? 'warm enough' : 'too cool'} />
            <Figure label="Wind shear" value={`${Math.round(ev.env.shear[i])} kt`} sub={ev.env.shear[i] < 12 ? 'low' : ev.env.shear[i] < 22 ? 'moderate' : 'high'} />
            <Figure label="Mid-level humidity" value={pct(ev.env.rh[i])} sub={ev.env.rh[i] >= 0.65 ? 'moist' : ev.env.rh[i] >= 0.45 ? 'marginal' : 'dry'} />
          </div>
        </section>
      )}
    </div>
  );
}

function fmtFeature(f: string, v: number): string {
  if (f === RI_FEATURES[0]) return `${Math.round(v)} kt`;
  if (f === RI_FEATURES[1]) return `${v >= 0 ? '+' : ''}${Math.round(v)} kt`;
  if (f === RI_FEATURES[2]) return `${v.toFixed(1)} °C`;
  if (f === RI_FEATURES[3]) return `${Math.round(v)} kt`;
  if (f === RI_FEATURES[4]) return pct(v);
  if (f === RI_FEATURES[5]) return `${v.toFixed(1)}°N`;
  return `${Math.round(v)} km/h`;
}

function truthLandfall(tr: TruthTrack) {
  for (let i = 1; i < tr.t.length; i++) {
    const a = isLandPoint(tr.lon[i - 1], tr.lat[i - 1]);
    const b = isLandPoint(tr.lon[i], tr.lat[i]);
    if (!a && b) {
      const cp = coastPosition(tr.lon[i], tr.lat[i]);
      return { t: tr.t[i], place: cp.dist < 200 ? cp.nearest.name : 'inland', region: cp.nearest.region, v: tr.v[i] };
    }
  }
  return null;
}

function Forecast({ ev, cone }: { ev: EventTrack; cone: Cone | null }) {
  const fmt = useFmt();
  const derived = useStore((s) => s.derived);
  const cycles = useStore((s) => s.cycles);
  const reveal = useStore((s) => s.reveal);
  const run = useStore((s) => s.run);
  const ensStatus = useStore((s) => s.ensembleStatus);
  const setFocusCity = useStore((s) => s.setFocusCity);
  const trend = cycles?.trends[ev.id];
  const truth = reveal && ev.truthId !== undefined ? run?.truth.find((x) => x.id === ev.truthId && x.kind === ev.kind) : undefined;
  const levels = useMemo(() => new Map((derived?.outlooks ?? []).map((o) => [o.city.id, o.maxLevel])), [derived]);
  const decisions = (derived?.decisions ?? []).filter((d) => d.eventId === ev.id).slice(0, 8);

  if (ev.kind !== 'cyclone') {
    return (
      <div className="stack">
        <p className="muted">
          Probability cones are built for cyclonic systems. For this event, open the Chart probability layers to see the ensemble's chance of {ev.kind === 'heat' ? 'heat-wave' : ev.kind === 'cold' ? 'cold-wave' : 'heavy rain'} conditions
          day by day.
        </p>
        <ForecastTable ev={ev} />
      </div>
    );
  }
  const lf = ev.landfall;
  const L = cone?.landfall;
  return (
    <div className="stack">
      <section>
        <h3 className="section-title">Landfall</h3>
        <div className="lf-grid">
          <div className="lf-card">
            <div className="label">Deterministic model</div>
            {lf ? (
              <>
                <div className="lf-card__main">{lf.place}</div>
                <div className="muted num">
                  {fmt.time(Math.round(lf.t))}, {catName(lf.cat).toLowerCase()}, {Math.round(lf.vmax)} kt
                </div>
              </>
            ) : (
              <div className="lf-card__main muted">Stays at sea</div>
            )}
          </div>
          <div className="lf-card">
            <div className="label">Ensemble, {cone ? `${cone.members} members` : ''}</div>
            {!cone ? (
              <div className="muted">{ensStatus === 'running' ? 'Running 21 members…' : 'Not enough members follow this system.'}</div>
            ) : L && L.members > 0 ? (
              <>
                <div className="lf-card__main">
                  {pct(L.probability)} {L.likely ? `between ${L.likely.fromName} and ${L.likely.toName}` : 'make landfall'}
                </div>
                {L.time && (
                  <div className="muted num">
                    {fmt.time(Math.round(L.time.p10))} to {fmt.time(Math.round(L.time.p90))}
                  </div>
                )}
              </>
            ) : (
              <div className="lf-card__main muted">No member makes landfall</div>
            )}
          </div>
        </div>
        {cone && <CoastRibbon cone={cone} modelArc={lf && lf.arcKm >= 0 ? lf.arcKm : null} fmtTime={fmt.time} />}
      </section>
      {cone && (
        <section>
          <h3 className="section-title">Cities at risk</h3>
          {cone.cities.length === 0 ? (
            <p className="muted">No city has a meaningful chance of gale-force winds.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>City</th>
                  <th className="num">Gale</th>
                  <th className="num">Storm</th>
                  <th>Arrival, 10 to 90%</th>
                </tr>
              </thead>
              <tbody>
                {cone.cities.slice(0, 9).map((c) => (
                  <tr key={c.city.id} onMouseEnter={() => setFocusCity(c.city.id)} onMouseLeave={() => setFocusCity(null)}>
                    <td>
                      <span className={`dot dot--${levels.get(c.city.id) ?? 0}`} /> {c.city.name}
                    </td>
                    <td className="num">{pct(c.pGale)}</td>
                    <td className="num">{pct(c.pStorm)}</td>
                    <td className="num muted">{c.arrival ? `${fmt.short(Math.round(c.arrival.p10))} to ${fmt.short(Math.round(c.arrival.p90))}` : 'n/a'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="faint small">Gale 34 kt and above, storm 48 kt and above, from the {cone.members} ensemble members that follow this system.</p>
        </section>
      )}
      {decisions.length > 0 && (
        <section>
          <h3 className="section-title">Decision clock</h3>
          <DecisionList decisions={decisions} />
        </section>
      )}
      <section>
        <h3 className="section-title">Earlier cycles</h3>
        {!trend ? (
          <p className="muted">Comparing with the last four model cycles…</p>
        ) : (
          <>
            <p className={`trend trend--${trend.verdict}`}>{trend.note}</p>
            <table className="table">
              <thead>
                <tr>
                  <th>Cycle</th>
                  <th>Landfall</th>
                  <th className="num">Peak</th>
                </tr>
              </thead>
              <tbody>
                {trend.runs.map((r) => (
                  <tr key={r.init}>
                    <td className="num">{r.init === 0 ? 'This run' : `${-r.init} h earlier`}</td>
                    <td>{r.landfall ? `${r.landfall.place}, ${fmt.short(Math.round(r.landfall.t))}` : <span className="muted">none</span>}</td>
                    <td className="num">{Math.round(r.peak)} kt</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      {reveal && (
        <section className="reveal">
          <h3 className="section-title">What actually happened</h3>
          {!truth ? <p className="muted">This event has no counterpart in the hidden truth: it was a model artefact.</p> : <RevealSummary ev={ev} truth={truth} cone={cone} />}
        </section>
      )}
    </div>
  );
}

function RevealSummary({ ev, truth, cone }: { ev: EventTrack; truth: TruthTrack; cone: Cone | null }) {
  const fmt = useFmt();
  const tl = truthLandfall(truth);
  const errs = [24, 48, 72, 96].map((lead) => {
    const p = ev.points.find((q) => q.t === lead);
    const k = truth.t.indexOf(lead);
    if (!p || k < 0) return null;
    return { lead, km: distKm(p.lon, p.lat, truth.lon[k], truth.lat[k]), dv: (p.vmax ?? 0) - truth.v[k] };
  });
  const peak = Math.max(...truth.v);
  return (
    <div className="stack-tight">
      <p>
        The real system peaked at <strong className="num">{Math.round(peak)} kt</strong> ({catName(peakCat(peak)).toLowerCase()})
        {tl ? (
          <>
            {' '}
            and crossed the coast near <strong>{tl.place}</strong> at {fmt.time(tl.t)}.
          </>
        ) : (
          ' and did not make landfall in the window.'
        )}
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Lead</th>
            <th className="num">Track error</th>
            <th className="num">Intensity bias</th>
          </tr>
        </thead>
        <tbody>
          {errs.map((e, i) =>
            e ? (
              <tr key={i}>
                <td className="num">{e.lead} h</td>
                <td className="num">{Math.round(e.km)} km</td>
                <td className="num">
                  {e.dv >= 0 ? '+' : ''}
                  {Math.round(e.dv)} kt
                </td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
      {cone && <p className="muted small">The truth stayed inside the 67% ellipse at {coverage(cone, truth)} of the lead times.</p>}
    </div>
  );
}

function peakCat(v: number) {
  return v >= 120 ? 'SuCS' : v >= 90 ? 'ESCS' : v >= 64 ? 'VSCS' : v >= 48 ? 'SCS' : v >= 34 ? 'CS' : v >= 28 ? 'DD' : v >= 17 ? 'D' : 'L';
}

function coverage(cone: Cone, truth: TruthTrack): string {
  let inside = 0;
  let total = 0;
  for (const e of cone.ellipses) {
    if (e.t <= 0) continue;
    const k = truth.t.indexOf(e.t);
    if (k < 0) continue;
    const dx = (truth.lon[k] - e.lon) * Math.cos((e.lat * Math.PI) / 180) * 111.19;
    const dy = (truth.lat[k] - e.lat) * 111.19;
    const th = ((90 - e.angle) * Math.PI) / 180;
    const u = dx * Math.cos(th) + dy * Math.sin(th);
    const v = -dx * Math.sin(th) + dy * Math.cos(th);
    total++;
    if ((u / e.a) ** 2 + (v / e.b) ** 2 <= 1) inside++;
  }
  return total ? `${inside} of ${total}` : 'none';
}

function ForecastTable({ ev }: { ev: EventTrack }) {
  const fmt = useFmt();
  const rows = ev.points.filter((p) => p.t >= 0 && p.t % 24 === 0);
  if (!rows.length) return <p className="muted">This event ends before the forecast period.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Day</th>
          <th>Where</th>
          <th className="num">{ev.kind === 'wd' ? 'Trough' : 'Peak'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.t}>
            <td className="num">{fmt.day(p.t)}</td>
            <td>{whereIs(p).replace(/^over /, '').split(',')[0]}</td>
            <td className="num">{ev.kind === 'wd' ? `${Math.round(p.amp ?? 0)} gpm` : ev.kind === 'heat' || ev.kind === 'cold' ? `${(p.peak ?? 0).toFixed(1)} °C` : `${Math.round(p.peak ?? 0)} mm`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DecisionList({ decisions }: { decisions: NonNullable<ReturnType<typeof useStore.getState>['derived']>['decisions'] }) {
  const fmt = useFmt();
  return (
    <ul className="decisions">
      {decisions.map((d, k) => (
        <li key={k} className={`decision decision--${d.status}`}>
          <div className="decision__top">
            <span className="decision__action">{d.action.label}</span>
            <span className="decision__city muted">{d.city.name}</span>
          </div>
          <div className="decision__meta num">
            <span className={`decision__status decision__status--${d.status}`}>
              {d.status === 'act-now' ? (d.lastMoment !== null && d.lastMoment < 0 ? `Act now, ${Math.round(-d.lastMoment)} h behind` : 'Act now') : d.status === 'act-by' ? `Act by ${fmt.time(d.lastMoment ?? 0)}` : d.status === 'prepare' ? 'Prepare' : 'Monitor'}
            </span>
            <span className="muted">
              {pct(d.p)} vs act-above {pct(d.action.threshold)}, needs {d.action.lead} h
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DnaTab({ ev }: { ev: EventTrack }) {
  const t = useStore((s) => s.t);
  const memory = useStore((s) => s.memory);
  const layers = useStore((s) => s.layers);
  const setLayer = useStore((s) => s.setLayer);
  const setView = useStore((s) => s.setView);
  const setMemorySel = useStore((s) => s.setMemorySel);
  const analogs = useAnalogs(ev.id);
  const guidance = memory?.analogs[ev.id]?.guidance;
  const nov = memory?.novelty[ev.id];
  const times = ev.points.map((p) => p.t);
  const live = ev.dna.genome.values;
  return (
    <div className="stack">
      <section>
        <h3 className="section-title">DNA strip</h3>
        <p className="muted small">One column per 6 hours, one row per trait. Darker means stronger. The magenta column is the playhead.</p>
        <DnaStrip dna={ev.dna} times={times} t={t} />
      </section>
      <section>
        <h3 className="section-title">Genotype</h3>
        <div className="genotype">
          {ev.dna.code.map((c, i) => (
            <span key={i} className="genotype__part" title={genotypeHint(ev, i)}>
              {c}
            </span>
          ))}
        </div>
        <p className="muted small">{genotypeSentence(ev)}</p>
      </section>
      <section>
        <h3 className="section-title">Closest relatives in Event Memory</h3>
        {!memory ? (
          <p className="muted">Event Memory is loading…</p>
        ) : !analogs.length ? (
          <p className="muted">No remembered event of this kind yet.</p>
        ) : (
          <>
            <div className="relatives">
              <div className="relative relative--self">
                <GenomeBars values={live} labels={ev.dna.genome.labels} highlight />
                <div className="relative__text">
                  <strong>{titleOf(ev)}</strong>
                  <span className="muted small">This event{analogs[0].age !== null ? `, first ${analogs[0].age} h` : ''}</span>
                </div>
              </div>
              {analogs.slice(0, 6).map((a) => (
                <button
                  key={a.event.id}
                  className="relative"
                  onClick={() => {
                    setMemorySel(a.event.id);
                    setView('memory');
                  }}
                >
                  <GenomeBars values={a.event.dna.genome.values} labels={a.event.dna.genome.labels} compare={live} />
                  <div className="relative__text">
                    <strong>
                      {a.event.name ? `${a.event.name} ` : ''}
                      {a.event.label}
                    </strong>
                    <span className="muted small">
                      {a.event.kind === 'cyclone' ? `${a.event.maxCat}, ${a.event.landfall ? `landfall ${a.event.landfall.region}` : 'no landfall'}` : a.event.maxCat}
                    </span>
                  </div>
                  <span className="relative__sim num">{pct(a.similarity)}</span>
                </button>
              ))}
            </div>
            <label className="toggle">
              <input type="checkbox" checked={layers.analogs} onChange={(e) => setLayer('analogs', e.target.checked)} />
              Show relatives' tracks on the chart
            </label>
          </>
        )}
      </section>
      {guidance && ev.kind === 'cyclone' && (
        <section>
          <h3 className="section-title">What relatives did next</h3>
          <div className="figs figs--3">
            <div className="fig">
              <div className="fig__label">Median peak</div>
              <div className="fig__value">
                <CatChip cat={guidance.medianPeakCat} />
              </div>
            </div>
            <div className="fig">
              <div className="fig__label">Made landfall</div>
              <div className="fig__value num">{pct(guidance.landfallP)}</div>
              <div className="fig__sub muted">{guidance.regions[0]?.region ?? ''}</div>
            </div>
            <div className="fig">
              <div className="fig__label">Rapid intensification</div>
              <div className="fig__value num">{pct(guidance.riP)}</div>
            </div>
          </div>
          <p className={`agree agree--${guidance.agreement}`}>{guidance.note}</p>
        </section>
      )}
      {nov !== undefined && (
        <section>
          <h3 className="section-title">Novelty</h3>
          <div className="novelty">
            <div className="meter">
              <span style={{ width: `${Math.round(nov * 100)}%` }} />
            </div>
            <span className="num">{nov.toFixed(2)}</span>
          </div>
          <p className="muted small">{nov > 0.6 ? 'Few close relatives in memory. Lean on the ensemble rather than on analogs.' : nov > 0.35 ? 'Some relatives exist, but none is a close match.' : 'Familiar territory: memory has several close relatives.'}</p>
        </section>
      )}
    </div>
  );
}

function genotypeHint(ev: EventTrack, i: number): string {
  if (ev.kind !== 'cyclone') return '';
  return ['Origin basin and 5-degree latitude band of genesis', 'Peak IMD category', 'Track shape: S straight, C curving, R recurving, E erratic', 'Rain intensity class, r1 to r4'][i] ?? '';
}

function genotypeSentence(ev: EventTrack): string {
  if (ev.kind !== 'cyclone') return 'A compact code for comparing events of this kind.';
  const [origin, cat, shape, rain] = ev.dna.code;
  const basin = origin[0] === 'B' ? 'the Bay of Bengal' : origin[0] === 'A' ? 'the Arabian Sea' : 'land';
  const band = Number(origin.slice(1)) * 5;
  const shapes: Record<string, string> = { S: 'a straight track', C: 'a curving track', R: 'a recurving track', E: 'an erratic track' };
  return `Born over ${basin} between ${band}° and ${band + 5}°N, peaking as ${catName(cat).toLowerCase()}, on ${shapes[shape] ?? 'a track'}, rain class ${rain.slice(1)} of 4.`;
}

function LineageTab({ ev }: { ev: EventTrack }) {
  const run = useStore((s) => s.run);
  const select = useStore((s) => s.select);
  const fmt = useFmt();
  if (!run) return null;
  const fam = familyOf(ev.id, run.relations);
  const nodes = run.events
    .filter((e) => fam.has(e.id))
    .map((e) => ({ id: e.id, label: e.kind === 'cyclone' && e.name ? e.name : e.label, sub: e.kind === 'cyclone' ? e.maxCat : undefined, t0: e.t0, t1: e.t1, kind: e.kind }));
  const edges = run.relations.filter((r) => fam.has(r.from) && fam.has(r.to));
  const name = (id: string) => {
    const e = run.events.find((x) => x.id === id);
    return e ? titleOf(e) : id;
  };
  return (
    <div className="stack">
      {nodes.length <= 1 ? (
        <div className="empty-state empty-state--inline">
          <h3>A single lineage</h3>
          <p className="muted">This event has no recorded parents or children in this run: it did not split, merge, regenerate or spawn other systems.</p>
        </div>
      ) : (
        <>
          <section>
            <h3 className="section-title">Family</h3>
            <LineageChart nodes={nodes} edges={edges} selected={ev.id} onSelect={select} fmtDay={fmt.day} />
          </section>
          <section>
            <h3 className="section-title">Relations</h3>
            <ul className="relations">
              {edges.map((r, k) => (
                <li key={k}>
                  <button className="relation" onClick={() => select(r.to === ev.id ? r.from : r.to)}>
                    <span className={`relation__type relation__type--${r.type}`}>{r.type}</span>
                    <span>
                      {name(r.to)} {RELATION_WORDS[r.type]} {name(r.from)}
                    </span>
                    <span className="muted num">{fmt.time(r.t)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <p className="faint small">
        Lineage is inferred by the tracker: a remnant that re-forms over another sea is linked as regenerated, a low born inside an established circulation as a split, a low that forms south of a western
        disturbance as induced, and a heavy-rain cluster next to a cyclone as its rain shield.
      </p>
    </div>
  );
}

export function warnChip(level: number) {
  return <span className={`chip chip--warn-${level}`}>{WARN_LEVELS[level].name}</span>;
}

export { catIndex };
