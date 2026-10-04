// Verification: because this atmosphere is synthetic, the truth is known and
// every product can be scored honestly.

import { RI_FEATURES } from '../engine/ri';
import type { LeadError } from '../engine/verify';
import { useWidth } from '../charts/useSize';
import { pct } from '../state/format';
import { useStore } from '../state/store';
import { titleOf } from '../engine/intel/phrases';
import { Drill } from './Drill';

export default function VerifyView() {
  const cycles = useStore((s) => s.cycles);
  const memory = useStore((s) => s.memory);
  const reveal = useStore((s) => s.reveal);
  const setReveal = useStore((s) => s.setReveal);
  const run = useStore((s) => s.run);
  const ensemble = useStore((s) => s.ensemble);
  const v = cycles ? (reveal ? cycles.verificationReveal : cycles.verification) : null;

  return (
    <div className="verify">
      <header className="verify__head">
        <div>
          <h1 className="verify__title">Verification</h1>
          <p className="muted verify__lede">
            This atmosphere is synthetic, so the truth is known. Every product is scored against it: the detector, the forecast tracks and intensities from the last four cycles, the probability
            cone and the rapid-intensification model.
          </p>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
          Include this run's forecast (reveals the outcome)
        </label>
      </header>
      {!v ? (
        <p className="muted">Scoring earlier cycles…</p>
      ) : (
        <div className="verify__grid">
          <Drill />
          <section className="card">
            <h2 className="card__title">Detector</h2>
            <p className="muted small">Cyclonic systems of depression strength, analysis period only.</p>
            <div className="figs figs--3">
              <div className="fig">
                <div className="fig__label">Probability of detection</div>
                <div className="fig__value num">{pct(v.detection.pod)}</div>
              </div>
              <div className="fig">
                <div className="fig__label">False-alarm ratio</div>
                <div className="fig__value num">{pct(v.detection.far)}</div>
              </div>
              <div className="fig">
                <div className="fig__label">Hits, misses, false alarms</div>
                <div className="fig__value num">
                  {v.detection.hits}, {v.detection.misses}, {v.detection.falseAlarms}
                </div>
              </div>
            </div>
          </section>
          <section className="card card--wide">
            <h2 className="card__title">Track error by lead time</h2>
            <p className="muted small">Mean great-circle distance between forecast and true centre. Persistence keeps the last 12 hours of motion going, the usual no-skill baseline.</p>
            {v.leads.length ? <ErrorChart leads={v.leads} /> : <p className="muted">Not enough verifiable forecasts yet.</p>}
            {v.skill !== null && (
              <p className="small">
                {v.skill > 0 ? (
                  <>
                    At 48 h the model's track error is <strong className="num">{pct(v.skill)}</strong> lower than persistence
                  </>
                ) : (
                  <>At 48 h the model does not beat persistence</>
                )}
                {(() => {
                  const l = v.leads.find((x) => x.lead === 48) ?? v.leads.find((x) => x.lead === 24);
                  return l ? ` (${l.n} case${l.n === 1 ? '' : 's'}${l.n < 4 ? ', too few to judge' : ''}).` : '.';
                })()}
              </p>
            )}
          </section>
          <section className="card">
            <h2 className="card__title">Intensity error</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th className="num">Cases</th>
                  <th className="num">Mean absolute error</th>
                </tr>
              </thead>
              <tbody>
                {v.leads.map((l) => (
                  <tr key={l.lead}>
                    <td className="num">{l.lead} h</td>
                    <td className="num">{l.n}</td>
                    <td className="num">{Math.round(l.intensity)} kt</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card">
            <h2 className="card__title">Probability cone</h2>
            {!reveal ? (
              <p className="muted small">Turn on “Include this run's forecast” to check how often the truth stayed inside the 67% cone.</p>
            ) : !v.coneCoverage ? (
              <p className="muted small">{ensemble ? 'No cone overlaps a verifiable truth track.' : 'The ensemble is still running.'}</p>
            ) : (
              <>
                <div className="calib">
                  <div className="calib__bar">
                    <span style={{ width: `${(v.coneCoverage.inside / v.coneCoverage.total) * 100}%` }} />
                    <i style={{ left: `${v.coneCoverage.expected * 100}%` }} />
                  </div>
                  <div className="num">
                    {v.coneCoverage.inside} of {v.coneCoverage.total} lead times inside ({pct(v.coneCoverage.inside / v.coneCoverage.total)})
                  </div>
                </div>
                <p className="muted small">A well-calibrated 67% cone contains the truth about two times in three. Much more means the cone is too wide; much less, overconfident.</p>
              </>
            )}
          </section>
          <section className="card">
            <h2 className="card__title">Rapid-intensification model</h2>
            {!memory ? (
              <p className="muted small">Trains once Event Memory has loaded.</p>
            ) : (
              <>
                <div className="figs figs--3">
                  <div className="fig">
                    <div className="fig__label">Held-out AUC</div>
                    <div className="fig__value num">{memory.riModel.auc.toFixed(2)}</div>
                  </div>
                  <div className="fig">
                    <div className="fig__label">Brier score</div>
                    <div className="fig__value num">{memory.riModel.brier.toFixed(3)}</div>
                  </div>
                  <div className="fig">
                    <div className="fig__label">Training points</div>
                    <div className="fig__value num">{memory.riModel.samples.toLocaleString('en-IN')}</div>
                    <div className="fig__sub muted">{memory.riModel.positives} rapid cases</div>
                  </div>
                </div>
                <div className="weights">
                  {RI_FEATURES.map((f, i) => {
                    const w = memory.riModel.weights[i];
                    return (
                      <div key={f} className="weights__row">
                        <span>{f}</span>
                        <span className="ri__bar">
                          <span className={w >= 0 ? 'up' : 'down'} style={{ width: `${Math.min(50, Math.abs(w) * 18)}%` }} />
                        </span>
                        <span className="num muted">{w >= 0 ? '+' : '−'}{Math.abs(w).toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="muted small">Standardised logistic weights. Magenta pushes towards rapid intensification, grey against it.</p>
              </>
            )}
          </section>
          <section className="card card--wide">
            <h2 className="card__title">Run-to-run consistency</h2>
            {!cycles || Object.keys(cycles.trends).length === 0 ? (
              <p className="muted small">No cyclonic system to compare across cycles.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>System</th>
                    <th>Verdict</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(cycles.trends).map((tr) => {
                    const ev = run?.events.find((e) => e.id === tr.eventId);
                    return (
                      <tr key={tr.eventId}>
                        <td>{ev ? titleOf(ev) : tr.eventId}</td>
                        <td>
                          <span className={`verdict verdict--${tr.verdict}`}>{tr.verdict.replace('-', ' ')}</span>
                        </td>
                        <td className="muted">{tr.note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ErrorChart({ leads }: { leads: LeadError[] }) {
  const [ref, w] = useWidth<HTMLDivElement>(520);
  const h = 210;
  const pad = { l: 44, r: 14, t: 12, b: 30 };
  const maxLead = Math.max(...leads.map((l) => l.lead), 24);
  const maxErr = Math.max(50, ...leads.map((l) => Math.max(l.track, l.persistence))) * 1.12;
  const x = (l: number) => pad.l + (l / maxLead) * (w - pad.l - pad.r);
  const y = (e: number) => h - pad.b - (e / maxErr) * (h - pad.t - pad.b);
  const path = (key: 'track' | 'persistence') => leads.map((l, i) => `${i ? 'L' : 'M'}${x(l.lead)} ${y(l[key])}`).join(' ');
  const yTicks = [0, 100, 200, 300, 400, 500].filter((v) => v < maxErr);
  return (
    <div ref={ref} className="chart">
      <svg width={w} height={h} className="errchart" role="img" aria-label="Track error by lead time">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="lc-grid" />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="lc-axis">
              {v} km
            </text>
          </g>
        ))}
        {leads.map((l) => (
          <text key={l.lead} x={x(l.lead)} y={h - 10} textAnchor="middle" className="lc-axis">
            {l.lead} h
          </text>
        ))}
        <path d={path('persistence')} className="err-line err-line--pers" />
        <path d={path('track')} className="err-line" />
        {leads.map((l) => (
          <g key={l.lead}>
            <circle cx={x(l.lead)} cy={y(l.track)} r={3} className="err-dot" />
            <title>{`${l.lead} h: ${Math.round(l.track)} km (persistence ${Math.round(l.persistence)} km), ${l.n} cases`}</title>
          </g>
        ))}
      </svg>
      <div className="lc-legend">
        <span>
          <i className="err-key" /> Model
        </span>
        <span>
          <i className="err-key err-key--pers" /> Persistence
        </span>
      </div>
    </div>
  );
}
