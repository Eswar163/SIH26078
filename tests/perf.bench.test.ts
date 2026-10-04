// Timing report for the heavy stages. Thresholds are generous so the test
// only fails on a real regression, not on a slow machine.
import { expect, it } from 'vitest';
import { deterministicRun } from '../src/engine/run';
import { runMember } from '../src/engine/ensemble';
import { buildArchive } from '../src/engine/archive';
import { makeWorld } from '../src/engine/world';

it('stays within the performance budget', () => {
  const t = () => performance.now();
  let a = t();
  const w = makeWorld('postmonsoon', 777, Date.UTC(2026, 9, 4));
  const world = t() - a;
  a = t();
  const run = deterministicRun({ season: 'postmonsoon', seed: 777, analysis: Date.UTC(2026, 9, 4) });
  const det = t() - a;
  a = t();
  runMember(w, 3);
  const member = t() - a;
  a = t();
  buildArchive();
  const archive = t() - a;
  console.log(`world ${world.toFixed(0)} ms, deterministic run ${det.toFixed(0)} ms (${run.output.times.length} steps on ${201 * 161} points), one member ${member.toFixed(0)} ms, archive ${archive.toFixed(0)} ms`);
  expect(det).toBeLessThan(6000);
  expect(member).toBeLessThan(2000);
  expect(archive).toBeLessThan(4000);
});
