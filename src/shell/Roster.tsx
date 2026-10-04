// Event roster: every tracked system, grouped by kind, with its state at the
// playhead time.

import { useMemo, useState } from 'react';
import type { EventKind } from '../engine/detect';
import type { EventTrack } from '../engine/events';
import { catIndex } from '../engine/imd';
import { shortWhere } from '../engine/intel/phrases';
import { intensityOf } from '../engine/lifecycle';
import { useFmt } from '../state/format';
import { useStore } from '../state/store';
import { IconChevron } from '../ui/icons';
import { CatChip, KIND_NAMES, KindGlyph } from '../ui/kind';
import { Sparkline } from '../charts/Sparkline';

const ORDER: EventKind[] = ['cyclone', 'wd', 'heat', 'cold', 'rain', 'storm'];

export function Roster() {
  const run = useStore((s) => s.run);
  const t = useStore((s) => s.t);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const hover = useStore((s) => s.hover);
  const derived = useStore((s) => s.derived);
  const fmt = useFmt();
  const [scope, setScope] = useState<'now' | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ rain: true, storm: true });

  const threatened = useMemo(() => {
    const m = new Map<string, number>();
    if (!derived) return m;
    for (const o of derived.outlooks)
      for (const d of o.days)
        for (const h of d.hazards) if (h.eventId) m.set(h.eventId, Math.max(m.get(h.eventId) ?? 0, h.level));
    return m;
  }, [derived]);

  if (!run) return <aside className="roster" />;
  const visible = run.events.filter((e) => (scope === 'now' ? e.t0 <= t && e.t1 >= t : e.t1 >= -72));
  const groups = ORDER.map((k) => ({ kind: k, items: visible.filter((e) => e.kind === k) })).filter((g) => g.items.length);

  return (
    <aside className="roster" aria-label="Tracked events">
      <div className="panel-head">
        <h2 className="panel-title">Events</h2>
        <div className="seg" role="group" aria-label="Show">
          <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            All
          </button>
          <button aria-pressed={scope === 'now'} onClick={() => setScope('now')}>
            At {fmt.short(t)}
          </button>
        </div>
      </div>
      <div className="roster__scroll">
        {groups.length === 0 && <p className="empty">No events at this time. Move the playhead or choose All.</p>}
        {groups.map((g) => {
          const isCollapsed = collapsed[g.kind] && !g.items.some((e) => e.id === selectedId);
          return (
            <section key={g.kind} className="roster__group">
              <button className="roster__group-head" onClick={() => setCollapsed({ ...collapsed, [g.kind]: !collapsed[g.kind] })} aria-expanded={!isCollapsed}>
                <IconChevron dir={isCollapsed ? 'right' : 'down'} />
                <span>{KIND_NAMES[g.kind]}</span>
                <span className="muted num">{g.items.length}</span>
              </button>
              {!isCollapsed && (
                <ul>
                  {g.items
                    .sort((a, b) => (g.kind === 'cyclone' ? catIndex(b.maxCat) - catIndex(a.maxCat) : 0) || a.t0 - b.t0)
                    .map((ev) => (
                      <RosterItem
                        key={ev.id}
                        ev={ev}
                        t={t}
                        selected={ev.id === selectedId}
                        threat={threatened.get(ev.id) ?? 0}
                        onSelect={() => select(ev.id)}
                        onHover={(h) => hover(h ? ev.id : null)}
                        fmtTime={fmt.time}
                      />
                    ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function RosterItem(props: { ev: EventTrack; t: number; selected: boolean; threat: number; onSelect: () => void; onHover: (h: boolean) => void; fmtTime: (t: number) => string }) {
  const { ev, t } = props;
  const p = ev.points.find((q) => q.t === t);
  const status = p ? shortWhere(p) : t < ev.t0 ? `Forms ${props.fmtTime(ev.t0)}` : `Ended ${props.fmtTime(ev.t1)}`;
  const values = ev.points.map((q) => intensityOf(ev.kind, q));
  const idx = ev.points.findIndex((q) => q.t === t);
  return (
    <li>
      <button
        className="roster-item"
        aria-current={props.selected ? 'true' : undefined}
        onClick={props.onSelect}
        onMouseEnter={() => props.onHover(true)}
        onMouseLeave={() => props.onHover(false)}
      >
        <KindGlyph kind={ev.kind} cat={p?.cat ?? ev.maxCat} />
        <span className="roster-item__main">
          <span className="roster-item__title">
            <span className="roster-item__name">{ev.kind === 'cyclone' && ev.name ? ev.name : ev.label}</span>
            {ev.kind === 'cyclone' && ev.name && <span className="muted">{ev.label}</span>}
            {ev.kind === 'cyclone' && !ev.name && ev.pendingName && <span className="faint">next name {ev.pendingName}</span>}
          </span>
          <span className={`roster-item__status ${p ? '' : 'faint'}`}>{status}</span>
        </span>
        <span className="roster-item__side">
          {ev.kind === 'cyclone' ? <CatChip cat={p?.cat ?? ev.maxCat} /> : <span className="chip">{(p ?? ev.points[ev.peakIndex]).cat}</span>}
          <span className="roster-item__spark">
            {props.threat > 0 && <span className={`dot dot--${props.threat}`} title="Threatens land" />}
            <Sparkline values={values} index={idx} width={54} height={16} />
          </span>
        </span>
      </button>
    </li>
  );
}
