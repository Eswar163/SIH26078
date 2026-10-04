import { beforeAll, describe, expect, it } from 'vitest';
import { deterministicRun, ENS_GRID, matchTruth, type DeterministicRun } from '../src/engine/run';
import { aggregate, runMember } from '../src/engine/ensemble';
import { buildCone } from '../src/engine/cone';
import { previousRuns, runTrend } from '../src/engine/runs';
import { verify } from '../src/engine/verify';
import { similarity, genomeOf } from '../src/engine/dna';
import { buildArchive } from '../src/engine/archive';
import { trainRiModel } from '../src/engine/ri';
import { findAnalogs } from '../src/engine/analogs';
import { attribute, runScenario, matchEvent } from '../src/engine/scenario';
import { NEUTRAL_SCENARIO } from '../src/engine/world';
import { cityOutlooks, decisionClock } from '../src/engine/decision';
import { buildBriefing } from '../src/engine/intel/briefing';
import { answer } from '../src/engine/intel/qa';
import { buildAlerts } from '../src/engine/intel/alerts';
import { bulletinFor } from '../src/engine/intel/bulletin';

const CONFIG = { season: 'postmonsoon' as const, seed: 20261004, analysis: Date.UTC(2026, 9, 4) };
let run: DeterministicRun;

beforeAll(() => {
  run = deterministicRun(CONFIG);
});

describe('deterministic run', () => {
  it('is reproducible for the same world', () => {
    const again = deterministicRun(CONFIG);
    expect(again.output.events.map((e) => [e.id, e.points.length, e.maxCat])).toEqual(run.output.events.map((e) => [e.id, e.points.length, e.maxCat]));
    const k = again.output.times.indexOf(48);
    expect(again.output.fields[k].mslp[12345]).toBe(run.output.fields[k].mslp[12345]);
  });
  it('tracks the main cyclone, names it and finds its landfall', () => {
    const main = run.output.events.find((e) => e.kind === 'cyclone' && e.name);
    expect(main).toBeTruthy();
    expect(['VSCS', 'ESCS', 'SuCS']).toContain(main!.maxCat);
    expect(main!.landfall?.region).toBe('Tamil Nadu');
    expect(main!.milestones.map((m) => m.type)).toEqual(expect.arrayContaining(['named', 'peak', 'landfall']));
  });
  it('links the remnant that regenerates over the Arabian Sea', () => {
    expect(run.output.relations.some((r) => r.type === 'regenerated')).toBe(true);
  });
  it('detects analysis-period cyclones reliably', () => {
    const v = verify({ events: run.output.events, detections: run.output.detections, times: run.output.times }, [], run.truth, false, []);
    expect(v.detection.pod).toBeGreaterThanOrEqual(0.85);
    expect(v.detection.far).toBeLessThanOrEqual(0.25);
  });
  it('fingerprints events: identical DNA is fully similar', () => {
    const ev = run.output.events.find((e) => e.kind === 'cyclone')!;
    const gnm = genomeOf('cyclone', ev.points);
    expect(similarity('cyclone', gnm, gnm)).toBeCloseTo(1, 9);
    expect(ev.dna.strip.length).toBe(8);
    expect(ev.dna.code.length).toBe(4);
  });
});

describe('ensemble, cone and verification', () => {
  it('builds a calibrated-looking cone and city threats', () => {
    const members = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => runMember(run.world, m));
    const ens = aggregate(run.output.events, members);
    const main = run.output.events.find((e) => e.kind === 'cyclone' && e.name)!;
    const cone = buildCone(main, ens.byEvent[main.id], ens.members, ENS_GRID);
    expect(cone.members).toBeGreaterThanOrEqual(6);
    expect(cone.ellipses.length).toBeGreaterThan(3);
    // Uncertainty grows with lead time.
    expect(cone.ellipses[cone.ellipses.length - 1].a).toBeGreaterThan(cone.ellipses[0].a);
    expect(cone.landfall.probability).toBeGreaterThan(0.5);
    expect(cone.cities[0].pGale).toBeGreaterThan(0.5);
    const strikeMax = Math.max(...cone.strike);
    expect(strikeMax).toBeLessThanOrEqual(1);
    expect(strikeMax).toBeGreaterThan(0.8);
  });
  it('earlier cycles verify better than persistence', () => {
    const prev = previousRuns(run.world);
    for (const p of prev) matchTruth(p.events, run.truth);
    const v = verify({ events: run.output.events, detections: run.output.detections, times: run.output.times }, prev, run.truth, true, []);
    const at24 = v.leads.find((l) => l.lead === 24)!;
    expect(at24.track).toBeLessThan(150);
    const l48 = v.leads.find((l) => l.lead === 48);
    if (l48) expect(l48.track).toBeLessThan(l48.persistence * 1.05);
    const main = run.output.events.find((e) => e.kind === 'cyclone' && e.name)!;
    expect(['steady', 'drifting', 'flip-flopping']).toContain(runTrend(main, prev).verdict);
  });
});

describe('memory, scenario and intelligence', () => {
  it('builds Event Memory and a skilful RI model', () => {
    const archive = buildArchive(2010, 2025);
    expect(archive.events.filter((e) => e.kind === 'cyclone').length).toBeGreaterThan(80);
    const model = trainRiModel(archive.events);
    expect(model.auc).toBeGreaterThan(0.7);
    const main = run.output.events.find((e) => e.kind === 'cyclone' && e.name)!;
    const analogs = findAnalogs(main, archive.events, 5);
    expect(analogs.length).toBe(5);
    expect(analogs[0].similarity).toBeGreaterThanOrEqual(analogs[4].similarity);
  });
  it('a neutral scenario reproduces the deterministic forecast', () => {
    const base = run.output.events.find((e) => e.kind === 'cyclone' && e.name)!;
    const sc = runScenario(run.world, { ...NEUTRAL_SCENARIO }, false);
    const m = matchEvent(base, sc.events)!;
    const p0 = base.points.find((p) => p.t === 24)!;
    const p1 = m.points.find((p) => p.t === 24)!;
    expect(Math.abs(p0.lon - p1.lon)).toBeLessThan(1e-6);
    expect(Math.abs((p0.vmax ?? 0) - (p1.vmax ?? 0))).toBeLessThan(1e-6);
  });
  it('Shapley contributions add up to the total change', () => {
    const base = run.output.events.find((e) => e.kind === 'cyclone' && e.name)!;
    const att = attribute(run.world, { ...NEUTRAL_SCENARIO, sstDeltaBay: 2, shearMult: 0.7 }, base.truthId!);
    const peak = att.find((a) => a.metric === 'peak')!;
    const sum = peak.contributions.reduce((s, c) => s + c.value, 0);
    expect(sum).toBeCloseTo((peak.scenario ?? 0) - (peak.base ?? 0), 6);
    expect(peak.scenario!).toBeGreaterThan(peak.base!);
  });
  it('writes a briefing, answers questions and drafts alerts', () => {
    const outlooks = cityOutlooks({ cones: [], ens: null, ensGrid: ENS_GRID, det: { fields: run.output.fields, times: run.output.times, grid: { lon0: 50, lat0: 0, d: 0.25, nx: 201, ny: 161 }, statics: run.output.statics } });
    const ctx = {
      season: CONFIG.season,
      analysis: CONFIG.analysis,
      tz: 'IST' as const,
      events: run.output.events,
      relations: run.output.relations,
      cones: {},
      members: null,
      analogs: {},
      novelty: {},
      ri: {},
      riModel: null,
      trends: {},
      outlooks,
      decisions: decisionClock(outlooks, [], 21),
    };
    const b = buildBriefing(ctx);
    expect(b.headline).toMatch(/Tamil Nadu/);
    expect(b.systems.length).toBeGreaterThan(0);
    expect(b.systems[0].sentences.every((s) => s.text.length > 10)).toBe(true);
    expect(answer('Where will the cyclone make landfall?', ctx).text).toMatch(/Mamallapuram|Tamil Nadu|coast/);
    expect(answer('Is Chennai at risk?', ctx).text).toMatch(/^Chennai/);
    const alerts = buildAlerts(run.output.events, outlooks, CONFIG.analysis);
    const tn = alerts.find((a) => a.region === 'Tamil Nadu');
    expect(tn?.messages.map((m) => m.lang)).toEqual(['en', 'hi', 'ta']);
    const main = run.output.events.find((e) => e.kind === 'cyclone' && e.name)!;
    expect(bulletinFor(main, CONFIG.analysis, undefined)).toMatch(/NOT AN OFFICIAL IMD PRODUCT/);
  });
});
