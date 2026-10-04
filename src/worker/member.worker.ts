/// <reference lib="webworker" />
// Ensemble member worker: rebuilds the (deterministic) world and runs the
// members it is given. Several of these run in parallel.

import { runMember } from '../engine/ensemble';
import { makeWorld, type World } from '../engine/world';
import type { FromMember, ToMember } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let cache: { key: string; world: World } | null = null;

self.onmessage = (e: MessageEvent<ToMember>) => {
  const msg = e.data;
  try {
    const key = `${msg.config.season}:${msg.config.seed}:${msg.config.analysis}`;
    if (!cache || cache.key !== key) cache = { key, world: makeWorld(msg.config.season, msg.config.seed, msg.config.analysis) };
    for (const m of msg.members) {
      const result = runMember(cache.world, m);
      const transfer: Transferable[] = [result.windMax.buffer];
      for (const list of [result.rainHeavy, result.rainVeryHeavy, result.heat, result.cold]) for (const a of list) transfer.push(a.buffer);
      self.postMessage({ type: 'member', id: msg.id, result } satisfies FromMember, transfer);
    }
    self.postMessage({ type: 'done', id: msg.id } satisfies FromMember);
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) } satisfies FromMember);
  }
};
