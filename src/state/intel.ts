// Builds the intelligence context (briefing, Q&A) from whatever results are in.

import { useMemo } from 'react';
import type { Analog } from '../engine/analogs';
import type { ArchiveEvent } from '../engine/archive';
import type { IntelContext } from '../engine/intel/briefing';
import { nowIndex } from '../engine/intel/briefing';
import type { RiPrediction } from '../engine/ri';
import { useStore } from './store';

export function useArchiveIndex(): Map<string, ArchiveEvent> | null {
  const memory = useStore((s) => s.memory);
  return useMemo(() => (memory ? new Map(memory.archive.events.map((e) => [e.id, e])) : null), [memory]);
}

export function useAnalogs(eventId: string | null): Analog[] {
  const memory = useStore((s) => s.memory);
  const index = useArchiveIndex();
  return useMemo(() => {
    if (!memory || !index || !eventId) return [];
    const a = memory.analogs[eventId];
    if (!a) return [];
    return a.list.map((x) => ({ event: index.get(x.id)!, similarity: x.similarity, age: x.age })).filter((x) => x.event);
  }, [memory, index, eventId]);
}

export function useIntelContext(): IntelContext | null {
  const run = useStore((s) => s.run);
  const ensemble = useStore((s) => s.ensemble);
  const memory = useStore((s) => s.memory);
  const cycles = useStore((s) => s.cycles);
  const derived = useStore((s) => s.derived);
  const tz = useStore((s) => s.tz);
  const index = useArchiveIndex();
  return useMemo(() => {
    if (!run) return null;
    const analogs: IntelContext['analogs'] = {};
    const ri: Record<string, RiPrediction | null> = {};
    if (memory && index) {
      for (const [id, a] of Object.entries(memory.analogs)) {
        analogs[id] = {
          list: a.list.map((x) => ({ event: index.get(x.id)!, similarity: x.similarity, age: x.age })).filter((x) => x.event),
          guidance: a.guidance,
        };
      }
      for (const ev of run.events) {
        const preds = memory.ri[ev.id];
        if (preds) ri[ev.id] = preds[nowIndex(ev)] ?? null;
      }
    }
    return {
      season: run.config.season,
      analysis: run.config.analysis,
      tz,
      events: run.events,
      relations: run.relations,
      cones: Object.fromEntries((ensemble?.cones ?? []).map((c) => [c.eventId, c])),
      members: ensemble?.products.members ?? null,
      analogs,
      novelty: memory?.novelty ?? {},
      ri,
      riModel: memory?.riModel ?? null,
      trends: cycles?.trends ?? {},
      outlooks: derived?.outlooks ?? [],
      decisions: derived?.decisions ?? [],
    };
  }, [run, ensemble, memory, cycles, derived, tz, index]);
}
