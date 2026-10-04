// Messages between the UI thread and the engine workers.

import type { Archive } from '../engine/archive';
import type { Analog, AnalogGuidance } from '../engine/analogs';
import type { Cone } from '../engine/cone';
import type { EnsembleProducts, MemberResult, MemberTrack } from '../engine/ensemble';
import type { EventTrack } from '../engine/events';
import type { GridSpec } from '../engine/grid';
import type { RiModel, RiPrediction } from '../engine/ri';
import type { RunConfig, TruthTrack } from '../engine/run';
import type { RunTrend } from '../engine/runs';
import type { Attribution } from '../engine/scenario';
import type { FieldSet } from '../engine/synth';
import type { Relation } from '../engine/track';
import type { Verification } from '../engine/verify';
import type { ObservedDay } from '../engine/drill';
import type { ScenarioParams } from '../engine/world';

export interface Statics {
  sst: Float32Array;
  shear: Float32Array;
  rh: Float32Array;
  elev: Float32Array;
  landFrac: Float32Array;
  landMask: Uint8Array;
  coastKm: Float32Array;
  tmaxNormal: Float32Array;
  tminNormal: Float32Array;
}

export interface RunPayload {
  config: RunConfig;
  grid: GridSpec;
  times: number[];
  fields: FieldSet[];
  statics: Statics;
  events: EventTrack[];
  relations: Relation[];
  truth: TruthTrack[];
  timing: { total: number };
}

export interface EnsemblePayload {
  grid: GridSpec;
  products: Omit<EnsembleProducts, 'byEvent' | 'unmatched'>;
  byEvent: Record<string, MemberTrack[]>;
  unmatched: MemberTrack[];
  cones: Cone[];
  timing: { total: number };
}

export interface CyclesPayload {
  previous: { init: number; events: EventTrack[] }[];
  trends: Record<string, RunTrend>;
  verification: Verification;
  verificationReveal: Verification;
}

export interface MemoryPayload {
  archive: Archive;
  riModel: RiModel;
  analogs: Record<string, { list: { id: string; similarity: number; age: number | null }[]; guidance: AnalogGuidance }>;
  novelty: Record<string, number>;
  ri: Record<string, (RiPrediction | null)[]>;
  timing: { total: number };
}

export interface ScenarioPayload {
  key: string;
  params: ScenarioParams;
  times: number[];
  fields: FieldSet[];
  events: EventTrack[];
  relations: Relation[];
  attribution: Attribution[] | null;
  focusTruthId: number | null;
}

export type ToEngine =
  | { type: 'run'; id: number; config: RunConfig }
  | { type: 'aggregate'; id: number; results: MemberResult[] }
  | { type: 'cycles'; id: number; reveal?: boolean }
  | { type: 'memory'; id: number }
  | { type: 'scenario'; id: number; params: ScenarioParams; focusEventId: string | null; withFields: boolean }
  | { type: 'drill'; id: number; cityIds: string[]; days: number };

export type FromEngine =
  | { type: 'progress'; id: number; stage: string; done: number; total: number }
  | { type: 'run'; id: number; payload: RunPayload }
  | { type: 'ensemble'; id: number; payload: EnsemblePayload }
  | { type: 'cycles'; id: number; payload: CyclesPayload }
  | { type: 'memory'; id: number; payload: MemoryPayload }
  | { type: 'scenario'; id: number; payload: ScenarioPayload }
  | { type: 'drill'; id: number; payload: Record<string, ObservedDay[]> }
  | { type: 'error'; id: number; message: string };

export type ToMember = { type: 'members'; id: number; config: RunConfig; members: number[] };
export type FromMember =
  | { type: 'member'; id: number; result: MemberResult }
  | { type: 'done'; id: number }
  | { type: 'error'; id: number; message: string };

export type { Analog };
