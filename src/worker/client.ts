// Promise-based access to the engine worker and the ensemble worker pool.

import type { MemberResult } from '../engine/ensemble';
import { ENSEMBLE_SIZE } from '../engine/ensemble';
import type { RunConfig } from '../engine/run';
import type { ScenarioParams } from '../engine/world';
import type { ObservedDay } from '../engine/drill';
import type { CyclesPayload, EnsemblePayload, FromEngine, FromMember, MemoryPayload, RunPayload, ScenarioPayload, ToEngine, ToMember } from './protocol';

type Progress = (stage: string, done: number, total: number) => void;
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: Progress;
}

export class EngineClient {
  private engine: Worker;
  private pool: Worker[] = [];
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.engine = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    this.engine.onmessage = (e: MessageEvent<FromEngine>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') {
        p.onProgress?.(msg.stage, msg.done, msg.total);
        return;
      }
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg.payload);
    };
    this.engine.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Engine worker failed'));
      this.pending.clear();
    };
  }

  private call<T>(msg: WithoutId<ToEngine>, onProgress?: Progress, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      this.engine.postMessage({ ...msg, id } as ToEngine, transfer);
    });
  }

  run(config: RunConfig, onProgress?: Progress): Promise<RunPayload> {
    return this.call<RunPayload>({ type: 'run', config }, onProgress);
  }

  cycles(): Promise<CyclesPayload> {
    return this.call<CyclesPayload>({ type: 'cycles' });
  }

  memory(): Promise<MemoryPayload> {
    return this.call<MemoryPayload>({ type: 'memory' });
  }

  drill(cityIds: string[], days: number): Promise<Record<string, ObservedDay[]>> {
    return this.call<Record<string, ObservedDay[]>>({ type: 'drill', cityIds, days });
  }

  scenario(params: ScenarioParams, focusEventId: string | null, withFields = true): Promise<ScenarioPayload> {
    return this.call<ScenarioPayload>({ type: 'scenario', params, focusEventId, withFields });
  }

  private ensurePool(): Worker[] {
    if (this.pool.length) return this.pool;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const n = Math.max(1, Math.min(6, cores - 1));
    for (let i = 0; i < n; i++) this.pool.push(new Worker(new URL('./member.worker.ts', import.meta.url), { type: 'module' }));
    return this.pool;
  }

  /** Run all members across the pool, then aggregate in the engine worker. */
  async ensemble(config: RunConfig, onProgress?: Progress): Promise<EnsemblePayload> {
    const pool = this.ensurePool();
    const id = this.nextId++;
    const chunks: number[][] = pool.map(() => []);
    for (let m = 0; m < ENSEMBLE_SIZE; m++) chunks[m % pool.length].push(m);
    const results: MemberResult[] = [];
    await Promise.all(
      pool.map(
        (w, i) =>
          new Promise<void>((resolve, reject) => {
            if (!chunks[i].length) return resolve();
            const handler = (e: MessageEvent<FromMember>) => {
              const msg = e.data;
              if (msg.id !== id) return;
              if (msg.type === 'member') {
                results.push(msg.result);
                onProgress?.('ensemble', results.length, ENSEMBLE_SIZE);
              } else if (msg.type === 'done') {
                w.removeEventListener('message', handler);
                resolve();
              } else {
                w.removeEventListener('message', handler);
                reject(new Error(msg.message));
              }
            };
            w.addEventListener('message', handler);
            w.addEventListener('error', (e) => reject(new Error(e.message || 'Ensemble worker failed')), { once: true });
            w.postMessage({ type: 'members', id, config, members: chunks[i] } satisfies ToMember);
          }),
      ),
    );
    results.sort((a, b) => a.member - b.member);
    const transfer: Transferable[] = [];
    for (const r of results) {
      transfer.push(r.windMax.buffer);
      for (const list of [r.rainHeavy, r.rainVeryHeavy, r.heat, r.cold]) for (const a of list) transfer.push(a.buffer);
    }
    return this.call<EnsemblePayload>({ type: 'aggregate', results }, undefined, transfer);
  }
}

let client: EngineClient | null = null;
export function engine(): EngineClient {
  if (!client) client = new EngineClient();
  return client;
}
