// Story captions: while the timeline plays, the chart narrates each milestone
// as the playhead passes it, so a run can be presented like a story.

import { useMemo } from 'react';
import type { EventTrack } from '../engine/events';
import { catIndex } from '../engine/imd';
import { useFmt } from '../state/format';
import { useStore } from '../state/store';

interface Caption {
  t: number;
  title: string;
  text: string;
}

export function StoryCaption() {
  const run = useStore((s) => s.run);
  const t = useStore((s) => s.t);
  const playing = useStore((s) => s.playing);
  const selectedId = useStore((s) => s.selectedId);
  const fmt = useFmt();

  const captions = useMemo<Caption[]>(() => {
    if (!run) return [];
    const important = (e: EventTrack) => e.kind === 'cyclone' ? catIndex(e.maxCat) >= 2 : e.kind === 'wd' || e.kind === 'heat' || e.kind === 'cold';
    const list: Caption[] = [];
    for (const ev of run.events) {
      if (!important(ev) && ev.id !== selectedId) continue;
      const name = ev.kind === 'cyclone' ? ev.name ?? ev.pendingName ?? ev.label : ev.label;
      for (const m of ev.milestones) {
        if (m.type === 'stall' || m.type === 'downgrade' || (m.type === 'peak' && ev.kind !== 'cyclone')) continue;
        list.push({ t: Math.round(m.t / 6) * 6, title: name, text: m.label });
      }
    }
    return list.sort((a, b) => a.t - b.t);
  }, [run, selectedId]);

  if (!playing) return null;
  const recent = captions.filter((c) => c.t <= t && c.t > t - 12);
  if (!recent.length) return null;
  const c = recent[recent.length - 1];
  return (
    <div className="story" role="status" aria-live="polite">
      <span className="story__time num">{fmt.time(c.t)}</span>
      <span className="story__title">{c.title}</span>
      <span className="story__text">{c.text}</span>
    </div>
  );
}
