// Warning drill: issue colour-coded warnings, lock them, then see what the
// hidden truth did and how your warnings score against Trikaal's.

import { useEffect, useMemo, useState } from 'react';
import { scoreWarnings, type DrillScore, type ObservedDay } from '../engine/drill';
import { WARN_LEVELS, type WarnLevel } from '../engine/imd';
import { CITIES, type City } from '../engine/places';
import { useFmt, pct } from '../state/format';
import { useStore } from '../state/store';
import { engine } from '../worker/client';

const DAYS = 3;

function storageKey(season: string, seed: number, analysis: number) {
  return `trikaal:drill:${season}:${seed}:${analysis}`;
}

export function Drill() {
  const derived = useStore((s) => s.derived);
  const season = useStore((s) => s.season);
  const seed = useStore((s) => s.seed);
  const analysis = useStore((s) => s.analysis);
  const setReveal = useStore((s) => s.setReveal);
  const fmt = useFmt();
  const key = storageKey(season, seed, analysis);

  const cities = useMemo<City[]>(() => {
    const picked = (derived?.outlooks ?? []).filter((o) => o.maxLevel >= 1).slice(0, 10).map((o) => o.city);
    for (const c of CITIES) {
      if (picked.length >= 8) break;
      if (c.country === 'India' && c.coastal && c.tier === 1 && !picked.includes(c)) picked.push(c);
    }
    return picked;
  }, [derived]);

  const [issued, setIssued] = useState<Record<string, WarnLevel[]>>({});
  const [locked, setLocked] = useState(false);
  const [observed, setObserved] = useState<Record<string, ObservedDay[]> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        setIssued(saved.issued ?? {});
        setLocked(!!saved.locked);
        setObserved(null);
        return;
      }
    } catch {
      /* storage unavailable */
    }
    setIssued({});
    setLocked(false);
    setObserved(null);
  }, [key]);

  const save = (next: Record<string, WarnLevel[]>, lock: boolean) => {
    try {
      localStorage.setItem(key, JSON.stringify({ issued: next, locked: lock }));
    } catch {
      /* storage unavailable */
    }
  };

  useEffect(() => {
    if (!locked || observed || !cities.length) return;
    setBusy(true);
    engine()
      .drill(
        cities.map((c) => c.id),
        DAYS,
      )
      .then((o) => setObserved(o))
      .finally(() => setBusy(false));
  }, [locked, observed, cities]);

  const trikaal = useMemo(() => {
    const out: Record<string, WarnLevel[]> = {};
    for (const c of cities) {
      const o = derived?.outlooks.find((x) => x.city.id === c.id);
      out[c.id] = Array.from({ length: DAYS }, (_, d) => (o?.days[d]?.level ?? 0) as WarnLevel);
    }
    return out;
  }, [cities, derived]);

  const level = (id: string, d: number) => (issued[id]?.[d] ?? 0) as WarnLevel;
  const cycle = (id: string, d: number) => {
    if (locked) return;
    const row = [...(issued[id] ?? Array(DAYS).fill(0))] as WarnLevel[];
    row[d] = ((row[d] + 1) % 4) as WarnLevel;
    const next = { ...issued, [id]: row };
    setIssued(next);
    save(next, false);
  };
  const filled = Object.fromEntries(cities.map((c) => [c.id, Array.from({ length: DAYS }, (_, d) => level(c.id, d))])) as Record<string, WarnLevel[]>;
  const mine: DrillScore | null = observed ? scoreWarnings(filled, observed, DAYS) : null;
  const theirs: DrillScore | null = observed ? scoreWarnings(trikaal, observed, DAYS) : null;

  return (
    <section className="card card--wide drill">
      <div className="drill__head">
        <div>
          <h2 className="card__title">Warning drill</h2>
          <p className="muted small">
            Issue a colour for each city and day, as if you were on duty. Then lock your warnings: Trikaal reveals what the hidden truth actually did and scores you against its own warnings.
          </p>
        </div>
        <div className="drill__actions">
          {!locked ? (
            <>
              <button
                className="btn btn--small"
                onClick={() => {
                  setIssued(trikaal);
                  save(trikaal, false);
                }}
              >
                Start from Trikaal's warnings
              </button>
              <button
                className="btn btn--small"
                onClick={() => {
                  setIssued({});
                  save({}, false);
                }}
              >
                Clear
              </button>
              <button
                className="btn btn--primary btn--small"
                onClick={() => {
                  setLocked(true);
                  save(filled, true);
                  setIssued(filled);
                  setReveal(true);
                }}
              >
                Lock and reveal
              </button>
            </>
          ) : (
            <button
              className="btn btn--small"
              onClick={() => {
                setLocked(false);
                setObserved(null);
                save(issued, false);
              }}
            >
              Start over
            </button>
          )}
        </div>
      </div>
      <table className="drill__table">
        <thead>
          <tr>
            <th>City</th>
            {Array.from({ length: DAYS }, (_, d) => (
              <th key={d}>{fmt.day(d * 24 + 6)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cities.map((c) => (
            <tr key={c.id}>
              <td>
                {c.name} <span className="faint small">{c.state}</span>
              </td>
              {Array.from({ length: DAYS }, (_, d) => {
                const mineL = level(c.id, d);
                const obs = observed?.[c.id]?.[d];
                const right = obs ? (mineL >= 2) === (obs.level >= 2) : null;
                return (
                  <td key={d}>
                    <button
                      className={`drill__cell drill__cell--${mineL} ${right === false ? 'drill__cell--wrong' : ''}`}
                      onClick={() => cycle(c.id, d)}
                      disabled={locked}
                      aria-label={`${c.name}, day ${d + 1}: ${WARN_LEVELS[mineL].name}${obs ? `, observed ${WARN_LEVELS[obs.level].name}` : ''}`}
                    >
                      <span>{WARN_LEVELS[mineL].name}</span>
                      {obs && (
                        <span className={`drill__obs drill__obs--${obs.level}`} title={obs.hazards.filter((h) => h.level > 0).map((h) => `${h.type} ${Math.round(h.value)}`).join(', ') || 'Nothing significant'}>
                          {WARN_LEVELS[obs.level].name.charAt(0)}
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {locked && (busy || !observed) && <p className="muted small">Replaying the truth at every city…</p>}
      {mine && theirs && (
        <div className="drill__scores">
          <Score label="Your warnings" s={mine} />
          <Score label="Trikaal's warnings" s={theirs} />
          <p className="faint small">
            Scored as a yes or no forecast of orange-or-worse conditions. Peirce skill is the hit rate minus the false-alarm rate: 1 is perfect, 0 is no better than chance. The small letter in each cell is what
            really happened.
          </p>
        </div>
      )}
    </section>
  );
}

function Score({ label, s }: { label: string; s: DrillScore }) {
  return (
    <div className="drill__score">
      <div className="label">{label}</div>
      <div className="figs figs--3">
        <div className="fig">
          <div className="fig__label">Peirce skill</div>
          <div className="fig__value num">{s.peirce.toFixed(2)}</div>
        </div>
        <div className="fig">
          <div className="fig__label">Hits, misses, false alarms</div>
          <div className="fig__value num">
            {s.hits}, {s.misses}, {s.falseAlarms}
          </div>
        </div>
        <div className="fig">
          <div className="fig__label">Exact colour</div>
          <div className="fig__value num">{pct(s.exact)}</div>
        </div>
      </div>
    </div>
  );
}
