/// <reference lib="webworker" />
// The engine worker owns the synthetic world and the deterministic run, and
// turns ensemble member results into cones and probability products.

import { analogGuidance, findAnalogs, novelty } from '../engine/analogs';
import { buildArchive, type Archive } from '../engine/archive';
import { buildCone, fitIntensityMapping, mapMembers, type Cone } from '../engine/cone';
import { aggregate, type EnsembleProducts } from '../engine/ensemble';
import { DET_GRID, ENS_GRID, deterministicRun, matchTruth, type DeterministicRun } from '../engine/run';
import { previousRuns, runTrend, type PreviousRun } from '../engine/runs';
import { predictRi, trainRiModel, type RiModel } from '../engine/ri';
import { attribute, runScenario, scenarioKey, matchEvent } from '../engine/scenario';
import { verify } from '../engine/verify';
import { observedHazards } from '../engine/drill';
import { CITY_BY_ID } from '../engine/places';
import type { FieldSet } from '../engine/synth';
import type { CyclesPayload, EnsemblePayload, FromEngine, MemoryPayload, RunPayload, ScenarioPayload, ToEngine } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let det: DeterministicRun | null = null;
let cones: Cone[] = [];
let ens: EnsembleProducts | null = null;
let prev: PreviousRun[] | null = null;
let archive: Archive | null = null;
let riModel: RiModel | null = null;

const post = (msg: FromEngine, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

function fieldBuffers(fields: FieldSet[]): Transferable[] {
  const out: Transferable[] = [];
  for (const f of fields) for (const a of [f.mslp, f.u10, f.v10, f.rain6, f.t2m, f.tmax, f.tmin, f.z500]) out.push(a.buffer);
  return out;
}

self.onmessage = (e: MessageEvent<ToEngine>) => {
  const msg = e.data;
  try {
    if (msg.type === 'run') {
      const t0 = performance.now();
      det = deterministicRun(msg.config, (done, total) => post({ type: 'progress', id: msg.id, stage: 'run', done, total }));
      cones = [];
      ens = null;
      prev = null;
      const o = det.output;
      const s = o.statics;
      const fields = o.fields;
      const payload: RunPayload = {
        config: msg.config,
        grid: DET_GRID,
        times: o.times,
        fields,
        statics: {
          sst: s.sst.slice(),
          shear: s.shear.slice(),
          rh: s.rh.slice(),
          elev: s.elev.slice(),
          landFrac: s.landFrac.slice(),
          landMask: s.landMask.slice(),
          coastKm: s.coastKm.slice(),
          tmaxNormal: s.tmaxNormal.slice(),
          tminNormal: s.tminNormal.slice(),
        },
        events: o.events,
        relations: o.relations,
        truth: det.truth,
        timing: { total: performance.now() - t0 },
      };
      post({ type: 'run', id: msg.id, payload }, fieldBuffers(fields));
      o.fields = [];
      return;
    }
    if (!det) throw new Error('No run loaded yet.');

    if (msg.type === 'aggregate') {
      const t0 = performance.now();
      ens = aggregate(det.output.events, msg.results);
      // Remove the coarse-grid intensity bias before building cones and products.
      const mapping = fitIntensityMapping(det.output.events, ens.byEvent);
      for (const id of Object.keys(ens.byEvent)) ens.byEvent[id] = mapMembers(ens.byEvent[id], mapping);
      cones = det.output.events
        .filter((ev) => ev.kind === 'cyclone' && ens!.byEvent[ev.id] && ens!.byEvent[ev.id].length >= 3)
        .map((ev) => buildCone(ev, ens!.byEvent[ev.id], ens!.members, ENS_GRID));
      const { byEvent, unmatched, ...products } = ens;
      const payload: EnsemblePayload = { grid: ENS_GRID, products, byEvent, unmatched, cones, timing: { total: performance.now() - t0 } };
      post({ type: 'ensemble', id: msg.id, payload });
      return;
    }

    if (msg.type === 'cycles') {
      if (!prev) {
        prev = previousRuns(det.world);
        for (const p of prev) matchTruth(p.events, det.truth);
      }
      const trends: CyclesPayload['trends'] = {};
      for (const ev of det.output.events) if (ev.kind === 'cyclone' && ev.t1 >= 0) trends[ev.id] = runTrend(ev, prev);
      const current = { events: det.output.events, detections: det.output.detections, times: det.output.times };
      const payload: CyclesPayload = {
        previous: prev.map((p) => ({ init: p.init, events: p.events })),
        trends,
        verification: verify(current, prev, det.truth, false, cones),
        verificationReveal: verify(current, prev, det.truth, true, cones),
      };
      post({ type: 'cycles', id: msg.id, payload });
      return;
    }

    if (msg.type === 'memory') {
      const t0 = performance.now();
      if (!archive) {
        archive = buildArchive();
        riModel = trainRiModel(archive.events);
      }
      const analogs: MemoryPayload['analogs'] = {};
      const nov: MemoryPayload['novelty'] = {};
      const ri: MemoryPayload['ri'] = {};
      for (const ev of det.output.events) {
        if (ev.kind === 'rain' || ev.kind === 'storm') continue;
        const list = findAnalogs(ev, archive.events, 8);
        analogs[ev.id] = { list: list.map((a) => ({ id: a.event.id, similarity: a.similarity, age: a.age })), guidance: analogGuidance(ev, list) };
        nov[ev.id] = novelty(ev, archive.events);
        if (ev.kind === 'cyclone') ri[ev.id] = ev.points.map((_, i) => predictRi(riModel!, ev, i));
      }
      const payload: MemoryPayload = { archive, riModel: riModel!, analogs, novelty: nov, ri, timing: { total: performance.now() - t0 } };
      post({ type: 'memory', id: msg.id, payload });
      return;
    }

    if (msg.type === 'drill') {
      const cities = msg.cityIds.map((id) => CITY_BY_ID.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
      post({ type: 'drill', id: msg.id, payload: observedHazards(det.world, cities, msg.days) });
      return;
    }

    if (msg.type === 'scenario') {
      const out = runScenario(det.world, msg.params, msg.withFields);
      matchTruth(out.events, det.truth);
      const focus = msg.focusEventId ? det.output.events.find((ev) => ev.id === msg.focusEventId) : null;
      let truthId: number | null = focus?.truthId ?? null;
      if (focus && truthId === null) {
        const m = matchEvent(focus, out.events);
        truthId = m?.truthId ?? null;
      }
      const attribution = truthId !== null ? attribute(det.world, msg.params, truthId) : null;
      const payload: ScenarioPayload = {
        key: scenarioKey(msg.params),
        params: msg.params,
        times: out.times,
        fields: out.fields,
        events: out.events,
        relations: out.relations,
        attribution,
        focusTruthId: truthId,
      };
      post({ type: 'scenario', id: msg.id, payload }, fieldBuffers(out.fields));
      return;
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
  }
};
