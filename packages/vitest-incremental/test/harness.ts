/**
 * Shared helpers for the fixture-based correctness suites: every scenario
 * starts from a warm cache where all fixture tests passed, applies one change,
 * and checks that exactly the expected files execute and that the result
 * agrees with a plain full Vitest run of the same checkout (the oracle).
 */
import { expect } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Fixture, REPO_ROOT } from './fixture';

export const ALL = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'm',
  's',
  'n',
  'o',
  'p',
  'q',
  'u',
  'v',
  'w',
].map((n) => `tests/${n}.test.ts`);

export const t = (...names: string[]) => names.map((n) => `tests/${n}.test.ts`).sort();

let counter = 0;
export function warmFixture() {
  const fixture = new Fixture(`case-${process.pid}-${counter++}`);
  const baseline = fixture.incremental();
  expect(baseline.executedFiles).toEqual([...ALL].sort());
  expect(baseline.failedFiles).toEqual([]);
  expect(baseline.recorded).toBe(ALL.length);
  return fixture;
}

export function expectRun(params: {
  fixture: Fixture;
  executed: string[];
  failed?: string[];
  env?: Record<string, string>;
}) {
  const { fixture, executed, failed = [], env } = params;
  const summary = fixture.incremental(env);
  expect(summary.executedFiles).toEqual(executed);
  expect(summary.failedFiles).toEqual(failed);
  // Oracle: anything failing in a full run must have been executed and failed here too.
  expect(fixture.fullSuiteFailures(env)).toEqual(failed);
  return summary;
}

/** Removes only this process's fixtures; other test processes may be using theirs. */
export function removeFixtures() {
  const root = join(REPO_ROOT, 'packages/vitest-incremental/.fixture');
  for (let i = 0; i < counter; i++) {
    rmSync(join(root, `case-${process.pid}-${i}`), { recursive: true, force: true });
  }
}
