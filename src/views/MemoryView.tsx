// Event Memory: browse 35 seasons of remembered events, see where any event
// sits in DNA space, find its relatives and its family.

import { useMemo, useState } from 'react';
import { embed } from '../engine/analogs';
import { archiveToEvent, type ArchiveEvent } from '../engine/archive';
import type { EventKind } from '../engine/detect';
import { GENOME_LABELS, similarity } from '../engine/dna';
import { catIndex } from '../engine/imd';
import { SEASONS, type SeasonId } from '../engine/climate';
import { DnaStrip, GenomeBars } from '../charts/DnaStrip';
import { LifecycleChart } from '../charts/LifecycleChart';
import { familyOf, LineageChart, RELATION_WORDS } from '../charts/Lineage';
import { useWidth } from '../charts/useSize';
import { MapView } from '../map/MapView';
import { font, type Frame } from '../map/draw';
import { project } from '../map/view';
import { pct } from '../state/format';
import { useArchiveIndex } from '../state/intel';
import { useStore } from '../state/store';
import { CatChip, KindGlyph } from '../ui/kind';
import { useThemeKey } from './ChartView';

const KINDS: { id: EventKind; label: string }[] = [
  { id: 'cyclone', label: 'Cyclonic' },
  { id: 'wd', label: 'WD' },
  { id: 'heat', label: 'Heat' },
  { id: 'cold', label: 'Cold' },
];

export default function MemoryView() {
  const memory = useStore((s) => s.memory);
  const status = useStore((s) => s.memoryStatus);
  const run = useStore((s) => s.run);
  const selectedLive = useStore((s) => s.selectedId);
  const sel = useStore((s) => s.memorySel);
  const setSel = useStore((s) => s.setMemorySel);
  const index = useArchiveIndex();
  const themeKey = useThemeKey();
  const [kind, setKind] = useState<EventKind>('cyclone');
  const [season, setSeason] = useState<SeasonId | 'all'>('all');
  const [minCat, setMinCat] = useState(2);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'tracks' | 'dna'>('tracks');

  const selected = sel && index ? index.get(sel) ?? null : null;
  const effKind = selected?.kind ?? kind;

  const filtered = useMemo(() => {
    if (!memory) return [];
    const q = query.trim().toLowerCase();
    return memory.archive.events
      .filter((e) => e.kind === effKind)
      .filter((e) => season === 'all' || e.season === season)
      .filter((e) => effKind !== 'cyclone' || catIndex(e.maxCat) >= minCat)
      .filter((e) => !q || e.label.toLowerCase().includes(q) || (e.name ?? '').toLowerCase().includes(q) || String(e.year).includes(q) || (e.landfall?.region ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.year - a.year || b.epoch - a.epoch);
  }, [memory, effKind, season, minCat, query]);

  if (!memory) {
    return (
      <div className="loading">
        <div className="loading__title">{status === 'error' ? 'Event Memory failed to load' : 'Building Event Memory'}</div>
        <div className="muted">Simulating 35 years of seasons and fingerprinting every system.</div>
      </div>
    );
  }

  const liveEvents = (run?.events ?? []).filter((e) => e.kind === effKind && (e.kind !== 'cyclone' || catIndex(e.maxCat) >= 2));
  const stats = {
    total: memory.archive.events.length,
    cyclones: memory.archive.events.filter((e) => e.kind === 'cyclone').length,
    storms: memory.archive.events.filter((e) => e.kind === 'cyclone' && catIndex(e.maxCat) >= 4).length,
    links: memory.archive.links.length,
  };

  return (
    <div className="memory">
      <aside className="memory__list">
        <div className="panel-head">
          <h2 className="panel-title">Event Memory</h2>
          <span className="muted small num">
            {memory.archive.years[0]} to {memory.archive.years[1]}
          </span>
        </div>
        <div className="memory__stats small muted num">
          {stats.total} events, {stats.cyclones} cyclonic systems, {stats.storms} named storms, {stats.links} lineage links
        </div>
        <div className="memory__filters">
          <div className="seg">
            {KINDS.map((k) => (
              <button
                key={k.id}
                aria-pressed={effKind === k.id}
                onClick={() => {
                  setKind(k.id);
                  setSel(null);
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="memory__filter-row">
            <select className="input input--select" value={season} onChange={(e) => setSeason(e.target.value as SeasonId | 'all')} aria-label="Season">
              <option value="all">All seasons</option>
              {(Object.keys(SEASONS) as SeasonId[]).map((s) => (
                <option key={s} value={s}>
                  {SEASONS[s].label}
                </option>
              ))}
            </select>
            {effKind === 'cyclone' && (
              <select className="input input--select" value={minCat} onChange={(e) => setMinCat(Number(e.target.value))} aria-label="Minimum strength">
                <option value={2}>Depression and above</option>
                <option value={4}>Cyclonic storm and above</option>
                <option value={6}>Very severe and above</option>
              </select>
            )}
          </div>
          <input className="input" placeholder="Search name, year or state" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the archive" />
        </div>
        <ul className="memory__items">
          {filtered.slice(0, 220).map((e) => (
            <li key={e.id}>
              <button className="archive-item" aria-current={e.id === sel ? 'true' : undefined} onClick={() => setSel(e.id)}>
                <KindGlyph kind={e.kind} cat={e.maxCat} />
                <span className="archive-item__main">
                  <span className="archive-item__title">
                    {e.name ? <strong>{e.name}</strong> : null}
                    <span className={e.name ? 'muted' : ''}>{e.label}</span>
                  </span>
                  <span className="archive-item__sub muted">
                    {SEASONS[e.season].label}
                    {e.landfall ? `, landfall ${e.landfall.region}` : e.kind === 'cyclone' ? ', no landfall' : ''}
                  </span>
                </span>
                <span className="archive-item__side">
                  {e.kind === 'cyclone' ? <CatChip cat={e.maxCat} /> : <span className="chip">{e.maxCat}</span>}
                  <GenomeBars values={e.dna.genome.values} labels={e.dna.genome.labels} height={14} />
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="empty">Nothing matches these filters.</li>}
          {filtered.length > 220 && <li className="empty">Showing 220 of {filtered.length}. Narrow the filters to see the rest.</li>}
        </ul>
      </aside>
      <div className="memory__center">
        <div className="memory__mode">
          <div className="seg">
            <button aria-pressed={mode === 'tracks'} onClick={() => setMode('tracks')}>
              Tracks
            </button>
            <button aria-pressed={mode === 'dna'} onClick={() => setMode('dna')}>
              DNA map
            </button>
          </div>
          <span className="muted small">{mode === 'tracks' ? `${filtered.length} tracks; the live run in magenta` : 'Each dot is an event placed by its DNA; neighbours are relatives.'}</span>
        </div>
        {mode === 'tracks' ? (
          <MapView
            grid={run!.grid}
            events={[]}
            t={0}
            fmtShort={() => ''}
            themeKey={themeKey}
            legend={false}
            cities
            warnings={false}
            extraDraw={(f) => drawArchive(f, filtered, selected, liveEvents.map((e) => e.points))}
            fitBox={{ w: 50, e: 100, s: 2, n: 38 }}
          />
        ) : (
          <DnaMap kind={effKind} items={filtered} live={liveEvents.map((e) => ({ id: e.id, label: e.name ?? e.label, genome: e.dna.genome.values }))} selected={sel} onSelect={setSel} />
        )}
      </div>
      <aside className="memory__detail">
        {selected ? (
          <ArchiveDossier ev={selected} pool={memory.archive.events} liveId={selectedLive} />
        ) : (
          <div className="empty-state">
            <h2>Pick a remembered event</h2>
            <p className="muted">Choose one from the list, the map or the DNA map to see its lifecycle, DNA, closest relatives and family.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function drawArchive(f: Frame, events: ArchiveEvent[], selected: ArchiveEvent | null, live: { lon: number; lat: number }[][]) {
  const { ctx, theme } = f;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = theme.ink2;
  ctx.globalAlpha = events.length > 120 ? 0.14 : 0.24;
  ctx.lineWidth = 1;
  for (const e of events) {
    if (e === selected) continue;
    ctx.beginPath();
    e.points.forEach((p, i) => {
      const [x, y] = project(f.view, f.w, f.h, p.lon, p.lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = theme.track;
  ctx.setLineDash([5, 3]);
  ctx.lineWidth = 1.6;
  for (const pts of live) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = project(f.view, f.w, f.h, p.lon, p.lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (selected) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    selected.points.forEach((p, i) => {
      const [x, y] = project(f.view, f.w, f.h, p.lon, p.lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    const p0 = selected.points[0];
    const [x0, y0] = project(f.view, f.w, f.h, p0.lon, p0.lat);
    ctx.beginPath();
    ctx.arc(x0, y0, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = theme.ink;
    ctx.fill();
    ctx.font = font(f, 12, 650, 96);
    ctx.lineWidth = 3;
    ctx.strokeStyle = theme.halo;
    ctx.strokeText(selected.name ?? selected.label, x0 + 6, y0 - 6);
    ctx.fillText(selected.name ?? selected.label, x0 + 6, y0 - 6);
  }
  ctx.restore();
}

function DnaMap({ kind, items, live, selected, onSelect }: { kind: EventKind; items: ArchiveEvent[]; live: { id: string; label: string; genome: number[] }[]; selected: string | null; onSelect: (id: string) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>(600);
  const [hover, setHover] = useState<string | null>(null);
  const emb = useMemo(() => {
    const all = [...items.map((e) => ({ id: e.id, genome: e.dna.genome.values })), ...live.map((l) => ({ id: `live:${l.id}`, genome: l.genome }))];
    return all.length > 2 ? embed(kind, all, GENOME_LABELS[kind]) : null;
  }, [kind, items, live]);
  const h = 520;
  if (!emb) return <div className="empty">Not enough events to map.</div>;
  const xs = emb.points.map((p) => p.x);
  const ys = emb.points.map((p) => p.y);
  const pad = 36;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const X = (v: number) => pad + ((v - minX) / (maxX - minX || 1)) * (w - pad * 2);
  const Y = (v: number) => h - pad - ((v - minY) / (maxY - minY || 1)) * (h - pad * 2);
  const byId = new Map(items.map((e) => [e.id, e]));
  const hovered = hover ? byId.get(hover) : null;
  return (
    <div ref={ref} className="dnamap">
      <svg width={w} height={h} role="img" aria-label="DNA map of remembered events">
        <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} className="dnamap__axis" />
        <line x1={pad} x2={pad} y1={pad} y2={h - pad} className="dnamap__axis" />
        <text x={w - pad} y={h - pad + 18} textAnchor="end" className="dnamap__axis-label">
          {emb.axes.x} →
        </text>
        <text x={pad - 8} y={pad - 10} className="dnamap__axis-label">
          ↑ {emb.axes.y}
        </text>
        {emb.points
          .filter((p) => !p.id.startsWith('live:'))
          .map((p) => {
            const e = byId.get(p.id)!;
            const r = 2.5 + (kind === 'cyclone' ? catIndex(e.maxCat) * 0.7 : 2);
            return (
              <circle
                key={p.id}
                cx={X(p.x)}
                cy={Y(p.y)}
                r={r}
                className={`dnamap__dot ${p.id === selected ? 'dnamap__dot--sel' : ''}`}
                onClick={() => onSelect(p.id)}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        {emb.points
          .filter((p) => p.id.startsWith('live:'))
          .map((p) => {
            const l = live.find((x) => `live:${x.id}` === p.id)!;
            return (
              <g key={p.id} transform={`translate(${X(p.x)}, ${Y(p.y)})`} className="dnamap__live">
                <circle r={6} />
                <text x={9} y={4}>
                  {l.label}
                </text>
              </g>
            );
          })}
        {hovered && (
          <g transform={`translate(${Math.min(w - 170, X(emb.points.find((p) => p.id === hovered.id)!.x) + 10)}, ${Y(emb.points.find((p) => p.id === hovered.id)!.y) - 10})`} className="dnamap__tip">
            <rect width={160} height={34} rx={4} />
            <text x={8} y={14}>
              {hovered.name ? `${hovered.name} ` : ''}
              {hovered.label}
            </text>
            <text x={8} y={27} className="muted">
              {hovered.maxCat}
              {hovered.landfall ? `, ${hovered.landfall.region}` : ''}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function ArchiveDossier({ ev, pool, liveId }: { ev: ArchiveEvent; pool: ArchiveEvent[]; liveId: string | null }) {
  const memory = useStore((s) => s.memory);
  const run = useStore((s) => s.run);
  const setSel = useStore((s) => s.setMemorySel);
  const asEvent = useMemo(() => archiveToEvent(ev, memory?.archive.links ?? []), [ev, memory]);
  const relatives = useMemo(
    () =>
      pool
        .filter((o) => o.kind === ev.kind && o.id !== ev.id)
        .map((o) => ({ o, s: similarity(ev.kind, ev.dna.genome.values, o.dna.genome.values) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 5),
    [ev, pool],
  );
  const live = run?.events.find((e) => e.id === liveId && e.kind === ev.kind) ?? null;
  const links = memory?.archive.links ?? [];
  const fam = familyOf(ev.id, links);
  const index = new Map(pool.map((e) => [e.id, e]));
  const family = [...fam].map((id) => index.get(id)).filter((x): x is ArchiveEvent => !!x);
  const dayFmt = (t: number) => {
    const d = new Date(ev.epoch + t * 3600_000);
    return `${String(d.getUTCDate()).padStart(2, '0')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
  };
  const peak = ev.points[asEvent.peakIndex];
  return (
    <div className="dossier__body dossier__body--archive">
      <div className="dossier__kicker">
        <KindGlyph kind={ev.kind} cat={ev.maxCat} />
        <span>
          {SEASONS[ev.season].label} {ev.year}
        </span>
      </div>
      <h2 className="dossier__title">{ev.name ?? ev.label}</h2>
      {ev.name && <div className="dossier__sub muted">{ev.label}</div>}
      <div className="stack" style={{ marginTop: 14 }}>
        <section className="figs">
          {ev.kind === 'cyclone' ? (
            <>
              <div className="fig">
                <div className="fig__label">Peak</div>
                <div className="fig__value num">{Math.round(peak.vmax ?? 0)} kt</div>
                <div className="fig__sub muted">{ev.maxCat}</div>
              </div>
              <div className="fig">
                <div className="fig__label">Landfall</div>
                <div className="fig__value">{ev.landfall ? ev.landfall.place : 'None'}</div>
                <div className="fig__sub muted">{ev.landfall ? `${ev.landfall.region}, ${Math.round(ev.landfall.vmax)} kt` : 'stayed at sea'}</div>
              </div>
            </>
          ) : (
            <div className="fig">
              <div className="fig__label">Peak</div>
              <div className="fig__value num">{ev.kind === 'wd' ? `${Math.round(peak.amp ?? 0)} gpm` : `${(peak.peak ?? 0).toFixed(1)} °C`}</div>
            </div>
          )}
          <div className="fig">
            <div className="fig__label">Lifetime</div>
            <div className="fig__value num">{Math.round(ev.duration / 6) * 6} h</div>
          </div>
        </section>
        <section>
          <h3 className="section-title">Lifecycle</h3>
          <LifecycleChart ev={asEvent} t={NaN} fmtDay={dayFmt} height={150} />
        </section>
        <section>
          <h3 className="section-title">DNA</h3>
          <DnaStrip dna={ev.dna} times={ev.points.map((p) => p.t)} t={NaN} />
          <div className="genotype" style={{ marginTop: 8 }}>
            {ev.dna.code.map((c, i) => (
              <span key={i} className="genotype__part">
                {c}
              </span>
            ))}
          </div>
        </section>
        {live && (
          <section>
            <h3 className="section-title">Against {live.name ?? live.label} in this run</h3>
            <div className="relative relative--self">
              <GenomeBars values={ev.dna.genome.values} labels={ev.dna.genome.labels} compare={live.dna.genome.values} />
              <div className="relative__text">
                <strong>{pct(similarity(ev.kind, ev.dna.genome.values, live.dna.genome.values))} similar</strong>
                <span className="muted small">Bars: this event. Magenta ticks: the live event.</span>
              </div>
            </div>
          </section>
        )}
        <section>
          <h3 className="section-title">Closest relatives</h3>
          <div className="relatives">
            {relatives.map(({ o, s }) => (
              <button key={o.id} className="relative" onClick={() => setSel(o.id)}>
                <GenomeBars values={o.dna.genome.values} labels={o.dna.genome.labels} compare={ev.dna.genome.values} />
                <div className="relative__text">
                  <strong>
                    {o.name ? `${o.name} ` : ''}
                    {o.label}
                  </strong>
                  <span className="muted small">{o.kind === 'cyclone' ? `${o.maxCat}${o.landfall ? `, ${o.landfall.region}` : ''}` : o.maxCat}</span>
                </div>
                <span className="relative__sim num">{pct(s)}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3 className="section-title">Family</h3>
          {family.length <= 1 ? (
            <p className="muted small">No recorded parents or children.</p>
          ) : (
            <>
              <LineageChart
                nodes={family.map((f) => ({ id: f.id, label: f.name ?? f.label, sub: f.kind === 'cyclone' ? f.maxCat : undefined, t0: f.points[0].t, t1: f.points[f.points.length - 1].t, kind: f.kind }))}
                edges={links.filter((l) => fam.has(l.from) && fam.has(l.to))}
                selected={ev.id}
                onSelect={setSel}
              />
              <ul className="relations">
                {links
                  .filter((l) => fam.has(l.from) && fam.has(l.to))
                  .map((l, i) => (
                    <li key={i} className="small">
                      {index.get(l.to)?.label} {RELATION_WORDS[l.type]} {index.get(l.from)?.label}
                    </li>
                  ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
