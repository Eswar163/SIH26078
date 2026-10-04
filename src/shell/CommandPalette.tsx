// Command palette (Ctrl K): jump to any event, view, layer or time, or ask the run a question.

import { useEffect, useMemo, useRef, useState } from 'react';
import { SEASONS, type SeasonId } from '../engine/climate';
import { useStore, type RasterLayer, type View } from '../state/store';
import { IconSearch } from '../ui/icons';

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPalette);
  const run = useStore((s) => s.run);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const s = useStore.getState();
    const list: Command[] = [];
    const views: [View, string][] = [
      ['chart', 'Chart'],
      ['memory', 'Event Memory'],
      ['scenario', 'Scenario Lab'],
      ['briefing', 'Briefing'],
      ['verify', 'Verification'],
    ];
    for (const [v, label] of views) list.push({ id: `view-${v}`, label: `Go to ${label}`, hint: 'View', run: () => s.setView(v) });
    for (const ev of run?.events ?? []) {
      if (ev.kind === 'storm') continue;
      list.push({
        id: `ev-${ev.id}`,
        label: `${ev.kind === 'cyclone' && ev.name ? `${ev.name} ` : ''}${ev.label}`,
        hint: ev.kind === 'cyclone' ? ev.maxCat : 'Event',
        run: () => {
          s.select(ev.id);
          s.setView('chart');
          const now = ev.points.find((p) => p.t === 0) ?? ev.points[0];
          s.setT(now.t);
        },
      });
    }
    const rasters: [RasterLayer, string][] = [
      ['rain6', 'Rain, 6 h'],
      ['rain24', 'Rain, 24 h'],
      ['wind', 'Wind speed'],
      ['t2m', 'Temperature'],
      ['tmax', 'Max temperature'],
      ['sst', 'Sea temperature'],
      ['shear', 'Wind shear'],
    ];
    for (const [r, label] of rasters) list.push({ id: `raster-${r}`, label: `Show ${label}`, hint: 'Layer', run: () => s.setLayer('raster', r) });
    list.push({ id: 'prob-strike', label: 'Show strike probability', hint: 'Layer', run: () => s.setLayer('prob', 'strike') });
    list.push({ id: 'wind-barbs', label: 'Show wind barbs', hint: 'Layer', run: () => s.setLayer('wind', 'barbs') });
    list.push({ id: 'wind-flow', label: 'Show wind flow', hint: 'Layer', run: () => s.setLayer('wind', 'flow') });
    for (const se of Object.keys(SEASONS) as SeasonId[]) list.push({ id: `season-${se}`, label: `Run a ${SEASONS[se].label.toLowerCase()} world`, hint: 'Run', run: () => s.setSeason(se) });
    list.push({ id: 'new', label: 'New world (random seed)', hint: 'Run', run: () => s.newWorld() });
    list.push({ id: 'reveal', label: s.reveal ? 'Hide the outcome' : 'Reveal the outcome', hint: 'Verification', run: () => s.setReveal(!s.reveal) });
    list.push({ id: 'now', label: 'Jump to analysis time', hint: 'Time', run: () => s.setT(0) });
    return list;
  }, [run, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const jump = qq.match(/^[+-]?\d+\s*h?$/);
    const base = qq ? commands.filter((c) => c.label.toLowerCase().includes(qq) || c.hint?.toLowerCase().includes(qq)) : commands;
    const extra: Command[] = [];
    if (jump) {
      const h = parseInt(qq, 10);
      extra.push({ id: 'jump', label: `Jump to ${h >= 0 ? '+' : ''}${h} h`, hint: 'Time', run: () => useStore.getState().setT(h) });
    }
    if (qq.length > 3 && /\?|where|when|how|which|what|is |will /.test(qq)) {
      extra.push({
        id: 'ask',
        label: `Ask: ${q.trim()}`,
        hint: 'Briefing',
        run: () => {
          const s = useStore.getState();
          // The Briefing view may not be mounted yet; it picks the question up when it is.
          s.setPendingAsk(q.trim());
          s.setView('briefing');
        },
      });
    }
    return [...extra, ...base].slice(0, 12);
  }, [q, commands]);

  if (!open) return null;
  const exec = (c: Command) => {
    setOpen(false);
    c.run();
  };
  return (
    <div className="palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette__input">
          <IconSearch />
          <input
            ref={input}
            value={q}
            placeholder="Jump to an event, layer or time, or ask a question"
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(filtered.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && filtered[active]) exec(filtered[active]);
              else if (e.key === 'Escape') setOpen(false);
            }}
          />
        </div>
        <ul className="palette__list" role="listbox">
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button className="menu-item" data-active={i === active} onMouseEnter={() => setActive(i)} onClick={() => exec(c)}>
                <span>{c.label}</span>
                {c.hint && <span className="palette__hint muted">{c.hint}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="empty">No match. Try an event name, a layer, or “+48”.</li>}
        </ul>
      </div>
    </div>
  );
}
