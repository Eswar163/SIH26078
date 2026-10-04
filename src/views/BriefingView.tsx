// AI Event Intelligence: the briefing document, Ask-the-run, public alerts in
// regional languages and the teleprinter advisory.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildAlerts, LANG_NAMES, type Alert } from '../engine/intel/alerts';
import { buildBriefing, type Evidence, type Sentence } from '../engine/intel/briefing';
import { bulletinFor } from '../engine/intel/bulletin';
import { answer, SUGGESTIONS, type Answer } from '../engine/intel/qa';
import { catIndex, WARN_LEVELS } from '../engine/imd';
import { sample } from '../engine/grid';
import { CITY_BY_ID } from '../engine/places';
import { useFmt } from '../state/format';
import { useIntelContext } from '../state/intel';
import { useStore } from '../state/store';
import { IconCopy, IconDownload, IconPrint, IconSend } from '../ui/icons';
import { DecisionList } from './Dossier';

const SOURCE_LABEL: Record<Evidence['source'], string> = {
  model: 'Model',
  ensemble: 'Ensemble',
  memory: 'Memory',
  ri: 'RI model',
  cycles: 'Earlier cycles',
  warnings: 'Warnings',
};

export default function BriefingView() {
  const ctx = useIntelContext();
  const derived = useStore((s) => s.derived);
  const ensStatus = useStore((s) => s.ensembleStatus);
  const memStatus = useStore((s) => s.memoryStatus);
  const fmt = useFmt();
  const briefing = useMemo(() => (ctx ? buildBriefing(ctx) : null), [ctx]);
  const [active, setActive] = useState<{ ev: Evidence[]; x: number; y: number } | null>(null);
  if (!ctx || !briefing) return null;

  const onEnter = (s: Sentence) => (e: React.MouseEvent | React.FocusEvent) => {
    if (!s.evidence.length) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setActive({ ev: s.evidence, x: Math.min(window.innerWidth - 300, r.left), y: r.bottom + 6 });
  };
  const sentences = (list: Sentence[]) =>
    list.map((s, i) => (
      <span key={i} className={`sent ${s.evidence.length ? 'sent--ev' : ''}`} tabIndex={s.evidence.length ? 0 : -1} onMouseEnter={onEnter(s)} onMouseLeave={() => setActive(null)} onFocus={onEnter(s)} onBlur={() => setActive(null)}>
        {s.text}{' '}
      </span>
    ));

  const pending = [ensStatus === 'running' ? 'ensemble' : null, memStatus === 'running' ? 'Event Memory' : null].filter(Boolean);

  return (
    <div className="briefing">
      <article className="doc" aria-label="Forecast briefing">
        <div className="doc__meta muted">
          <span>Briefing for {fmt.run()}</span>
          <span className="doc__actions">
            <button className="btn btn--small" onClick={() => window.print()}>
              <IconPrint /> Print
            </button>
          </span>
        </div>
        <h1 className="doc__headline">{briefing.headline}</h1>
        <p className="doc__lede muted">
          {briefing.issued}. Hover any underlined sentence to see the numbers and the source behind it.
          {pending.length > 0 && ` Still computing: ${pending.join(' and ')}; the text will update.`}
        </p>
        <section className="doc__section">
          <p className="doc__para">{sentences(briefing.overview)}</p>
        </section>
        {briefing.systems.map((sys) => (
          <section key={sys.eventId} className="doc__section">
            <h2 className="doc__h2">
              {sys.title}
              <span className="doc__kicker muted">{sys.kicker}</span>
            </h2>
            <p className="doc__para">{sentences(sys.sentences)}</p>
          </section>
        ))}
        <section className="doc__section">
          <h2 className="doc__h2">Actions</h2>
          <p className="doc__para">{sentences(briefing.warnings)}</p>
          {derived && derived.decisions.length > 0 && <DecisionList decisions={derived.decisions.slice(0, 6)} />}
        </section>
        <section className="doc__section">
          <h2 className="doc__h2">
            Confidence
            <span className={`conf conf--${briefing.confidence.level}`}>{briefing.confidence.level}</span>
          </h2>
          <ul className="doc__list">
            {briefing.confidence.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
        <section className="doc__section">
          <h2 className="doc__h2">Since earlier cycles</h2>
          <p className="doc__para">{sentences(briefing.changes)}</p>
        </section>
        <section className="doc__section">
          <h2 className="doc__h2">Colour-coded warnings, next five days</h2>
          <WarningGrid />
        </section>
        <p className="doc__foot faint">
          Generated from a synthetic model run for training and demonstration. It is not an official IMD forecast. Every statement is computed from the run, the ensemble, Event Memory or the
          earlier cycles; nothing is free-written.
        </p>
      </article>
      <aside className="briefing__side">
        <AskPanel />
        <AlertsPanel />
        <BulletinPanel />
      </aside>
      {active && (
        <div className="evidence" style={{ left: active.x, top: active.y }} role="tooltip">
          {active.ev.map((e, i) => (
            <div key={i} className="evidence__row">
              <span className="evidence__label">{e.label}</span>
              <span className="evidence__value num">{e.value}</span>
              <span className={`evidence__src evidence__src--${e.source}`}>{SOURCE_LABEL[e.source]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WarningGrid() {
  const derived = useStore((s) => s.derived);
  const fmt = useFmt();
  const setFocusCity = useStore((s) => s.setFocusCity);
  const setView = useStore((s) => s.setView);
  if (!derived) return null;
  const rows = derived.outlooks.filter((o) => o.maxLevel >= 1).slice(0, 16);
  if (!rows.length) return <p className="muted">All cities are green for the next five days.</p>;
  const initials: Record<string, string> = { wind: 'W', rain: 'R', heat: 'H', cold: 'C' };
  return (
    <>
      <table className="warngrid">
        <thead>
          <tr>
            <th>City</th>
            {rows[0].days.map((d) => (
              <th key={d.day} className="num">
                {fmt.day((d.day - 1) * 24 + 6)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.city.id}>
              <td>
                <button
                  className="linklike"
                  onClick={() => {
                    setFocusCity(o.city.id);
                    setView('chart');
                  }}
                >
                  {o.city.name}
                </button>
                <span className="faint small"> {o.city.state}</span>
              </td>
              {o.days.map((d) => (
                <td key={d.day} className={`warncell warncell--${d.level}`} title={d.hazards.map((h) => `${h.text}: ${Math.round(h.p * 100)}%`).join(', ') || 'No warning'}>
                  {d.hazards
                    .filter((h) => h.level === d.level && d.level > 0)
                    .map((h) => initials[h.type])
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .join(' ')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="warnkey small muted">
        {WARN_LEVELS.map((w) => (
          <span key={w.level}>
            <span className={`dot dot--${w.level}`} /> {w.name}: {w.advice.toLowerCase()}
          </span>
        ))}
        <span>W wind, R rain, H heat, C cold</span>
      </div>
    </>
  );
}

function AskPanel() {
  const ctx = useIntelContext();
  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  const setT = useStore((s) => s.setT);
  const setFocusCity = useStore((s) => s.setFocusCity);
  const [q, setQ] = useState('');
  const [history, setHistory] = useState<{ q: string; a: Answer }[]>([]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const ask = (text: string) => {
    if (!ctxRef.current || !text.trim()) return;
    const a = answer(text, ctxRef.current);
    setHistory((h) => [{ q: text.trim(), a }, ...h].slice(0, 6));
    setQ('');
  };

  const pendingAsk = useStore((s) => s.pendingAsk);
  const setPendingAsk = useStore((s) => s.setPendingAsk);
  useEffect(() => {
    if (!pendingAsk || !ctx) return;
    ask(pendingAsk);
    setPendingAsk(null);
  }, [pendingAsk, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="side-card">
      <h2 className="side-card__title">Ask the run</h2>
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Is Chennai at risk? Where will it make landfall?" aria-label="Question" />
        <button className="btn btn--primary btn--icon" type="submit" aria-label="Ask">
          <IconSend />
        </button>
      </form>
      {history.length === 0 && (
        <div className="suggest">
          {SUGGESTIONS.slice(0, 5).map((s) => (
            <button key={s} className="suggest__chip" onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <ol className="answers">
        {history.map((h, i) => (
          <li key={i} className="answer">
            <div className="answer__q">{h.q}</div>
            <p className="answer__a">{h.a.text}</p>
            {h.a.evidence.length > 0 && (
              <div className="answer__ev">
                {h.a.evidence.map((e, k) => (
                  <span key={k} className={`evchip evchip--${e.source}`}>
                    {e.label}: <span className="num">{e.value}</span>
                  </span>
                ))}
              </div>
            )}
            {(h.a.focus?.eventId || h.a.focus?.cityId) && (
              <button
                className="btn btn--small"
                onClick={() => {
                  if (h.a.focus?.eventId) select(h.a.focus.eventId);
                  if (h.a.focus?.t !== undefined) setT(h.a.focus.t);
                  if (h.a.focus?.cityId) setFocusCity(h.a.focus.cityId);
                  setView('chart');
                }}
              >
                Show on the chart
              </button>
            )}
            {h.a.suggestions && (
              <div className="suggest">
                {h.a.suggestions.slice(0, 4).map((s) => (
                  <button key={s} className="suggest__chip" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function AlertsPanel() {
  const run = useStore((s) => s.run);
  const derived = useStore((s) => s.derived);
  const alerts = useMemo<Alert[]>(() => {
    if (!run || !derived) return [];
    const sampler = (cityId: string, type: 'heat' | 'rain' | 'cold', day: number) => {
      const c = CITY_BY_ID.get(cityId);
      if (!c) return null;
      const t = day * 24;
      const k = run.times.indexOf(t);
      if (k < 0) return null;
      if (type === 'heat') return sample(run.grid, run.fields[k].tmax, c.lon, c.lat);
      if (type === 'cold') return sample(run.grid, run.fields[k].tmin, c.lon, c.lat);
      let r = 0;
      for (let h = t - 18; h <= t; h += 6) {
        const kk = run.times.indexOf(h);
        if (kk >= 0) r += sample(run.grid, run.fields[kk].rain6, c.lon, c.lat);
      }
      return r;
    };
    return buildAlerts(run.events, derived.outlooks, run.config.analysis, sampler);
  }, [run, derived]);
  return (
    <section className="side-card">
      <h2 className="side-card__title">Public alerts</h2>
      {alerts.length === 0 ? <p className="muted small">No alert-worthy hazard in this run.</p> : alerts.map((a) => <AlertCard key={a.id} alert={a} />)}
      <p className="faint small">Written from fixed templates in English, Hindi and the language of the affected state. Review before sending.</p>
    </section>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  const [lang, setLang] = useState(alert.messages[0].lang);
  const msg = alert.messages.find((m) => m.lang === lang) ?? alert.messages[0];
  const [copied, setCopied] = useState(false);
  return (
    <div className="alert">
      <div className="alert__head">
        <span className="alert__title">{alert.title}</span>
        <div className="seg">
          {alert.messages.map((m) => (
            <button key={m.lang} aria-pressed={m.lang === lang} onClick={() => setLang(m.lang)}>
              {LANG_NAMES[m.lang]}
            </button>
          ))}
        </div>
      </div>
      <p className="alert__text" lang={lang}>
        {msg.text}
      </p>
      <div className="alert__foot">
        <span className="faint small num">{[...msg.text].length} characters</span>
        <button
          className="btn btn--small"
          onClick={() => {
            void navigator.clipboard?.writeText(msg.text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
          }}
        >
          <IconCopy /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function BulletinPanel() {
  const run = useStore((s) => s.run);
  const ensemble = useStore((s) => s.ensemble);
  const candidates = (run?.events ?? []).filter((e) => e.kind === 'cyclone' && e.t1 >= 0 && catIndex(e.maxCat) >= 2);
  const [id, setId] = useState<string | null>(null);
  const ev = candidates.find((e) => e.id === id) ?? candidates[0];
  const text = useMemo(() => (ev && run ? bulletinFor(ev, run.config.analysis, ensemble?.cones.find((c) => c.eventId === ev.id)) : ''), [ev, run, ensemble]);
  const [copied, setCopied] = useState(false);
  if (!run) return null;
  return (
    <section className="side-card">
      <h2 className="side-card__title">Cyclone advisory</h2>
      {!ev ? (
        <p className="muted small">No depression or cyclone is active in the forecast window.</p>
      ) : (
        <>
          {candidates.length > 1 && (
            <div className="seg seg--wrap">
              {candidates.map((c) => (
                <button key={c.id} aria-pressed={c.id === ev.id} onClick={() => setId(c.id)}>
                  {c.name ?? c.label}
                </button>
              ))}
            </div>
          )}
          <pre className="teletype">{text}</pre>
          <div className="alert__foot">
            <button
              className="btn btn--small"
              onClick={() => {
                void navigator.clipboard?.writeText(text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                });
              }}
            >
              <IconCopy /> {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              className="btn btn--small"
              onClick={() => {
                const blob = new Blob([text], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `trikaal-advisory-${ev.label.replace(/\s+/g, '').toLowerCase()}.txt`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              <IconDownload /> Save as text
            </button>
          </div>
        </>
      )}
    </section>
  );
}
