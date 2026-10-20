/**
 * Correctness suite for the incremental runner.
 *
 * Every scenario starts from a warm cache where all fixture tests passed,
 * applies one change, and checks two things:
 *  1. exactly the expected test files execute (precision and recall), and
 *  2. the incremental result agrees with a plain full Vitest run of the same
 *     checkout (the oracle) — a test that fails in the full run but was skipped
 *     would be a false negative.
 *
 *   bun run --filter @dltech/vitest-incremental test
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { ALL, expectRun, removeFixtures, t, warmFixture } from './harness';

setDefaultTimeout(180_000);

afterAll(removeFixtures);

describe('reuse', () => {
  test('no change reuses every result', () => {
    const fixture = warmFixture();
    const summary = expectRun({ fixture, executed: [] });
    expect(summary.reused).toBe(ALL.length);
  });

  test('unrelated file change reuses every result', () => {
    const fixture = warmFixture();
    fixture.write('src/unrelated.ts', 'export const unrelated = 2;\n');
    expectRun({ fixture, executed: [] });
  });

  test('change to a module only replaced by a vi.mock factory reuses the result', () => {
    const fixture = warmFixture();
    fixture.write('src/heavy.ts', `export const heavy = 'changed';\n`);
    expectRun({ fixture, executed: [] });
  });
});

describe('invalidation', () => {
  test('source change reruns its dependents, including through vi.resetModules', () => {
    const fixture = warmFixture();
    fixture.write('src/math.ts', 'export const add = (a: number, b: number) => a + b + 1;\n');
    expectRun({ fixture, executed: t('a', 'j'), failed: t('a', 'j') });
  });

  test('test file change reruns only that file', () => {
    const fixture = warmFixture();
    fixture.write('tests/b.test.ts', fixture.read('tests/b.test.ts') + '// edited\n');
    expectRun({ fixture, executed: t('b') });
  });

  test('shared dependency change reruns every dependent', () => {
    const fixture = warmFixture();
    fixture.write('src/shared.ts', `export const shared = 'shared-v2';\n`);
    expectRun({ fixture, executed: t('b', 'c'), failed: t('b', 'c') });
  });

  test('dynamic import target change reruns tests that loaded it', () => {
    const fixture = warmFixture();
    fixture.write('src/lazy.ts', `export const lazy = 'lazy-v2';\n`);
    expectRun({ fixture, executed: t('d', 'j'), failed: t('d', 'j') });
  });

  test('setup file dependency change reruns everything', () => {
    const fixture = warmFixture();
    fixture.write('setup-helper.ts', `export const SETUP = 'broken';\n`);
    expectRun({ fixture, executed: [...ALL].sort(), failed: t('s') });
  });

  test('__mocks__ file change reruns the test using the manual mock', () => {
    const fixture = warmFixture();
    fixture.write('src/__mocks__/auto.ts', `export const auto = () => 'manual-mock-v2';\n`);
    expectRun({ fixture, executed: t('i'), failed: t('i') });
  });

  test('module imported by a vi.mock factory reruns the mocking test', () => {
    const fixture = warmFixture();
    fixture.write('src/mock-helper.ts', `export const mocked = 'mocked-v2';\n`);
    expectRun({ fixture, executed: t('e'), failed: t('e') });
  });

  test('automocked module change reruns the test (automocking loads the original)', () => {
    const fixture = warmFixture();
    fixture.write('src/plain.ts', `export const plain = () => 'real';\n`);
    expectRun({ fixture, executed: t('m'), failed: t('m') });
  });

  test('deleting a module replaced by a vi.mock factory reruns the mocking test', () => {
    const fixture = warmFixture();
    fixture.remove('src/heavy.ts');
    const summary = fixture.incremental();
    expect(summary.executedFiles).toEqual(t('e'));
    expect(summary.failedFiles).toEqual(fixture.fullSuiteFailures());
  });

  test('fs fixture change reruns the test that read it', () => {
    const fixture = warmFixture();
    fixture.write('fixtures/data.json', '{ "value": 2 }\n');
    expectRun({ fixture, executed: t('f'), failed: t('f') });
  });

  test('new file in a directory the test listed reruns it', () => {
    const fixture = warmFixture();
    fixture.write('fixtures/plugins/two.txt', 'two\n');
    expectRun({ fixture, executed: t('g'), failed: t('g') });
  });

  test('environment variable read by a test reruns only that test (and env enumerators)', () => {
    const fixture = warmFixture();
    // p lists process.env's names, so any new variable reruns it too.
    expectRun({ fixture, executed: t('h', 'p'), failed: t('h'), env: { FIXTURE_FLAG: 'on' } });
  });

  test('session and per-invocation variables do not invalidate, even for a test that spreads process.env', () => {
    const fixture = warmFixture();
    const env = {
      TERM: 'xterm-other',
      _: '/usr/bin/other',
      SHLVL: '9',
      INVOCATION_ID: 'x',
      SUDO_COMMAND: 'y',
      GITHUB_RUN_ID: '1',
    };
    expectRun({ fixture, executed: [], env });
  });

  test('global inputs (config, lockfile, global env) rerun everything', () => {
    const configFixture = warmFixture();
    configFixture.write('vitest.config.ts', configFixture.read('vitest.config.ts') + '// edited\n');
    expectRun({ fixture: configFixture, executed: [...ALL].sort() });

    const lockFixture = warmFixture();
    lockFixture.write('fixture.lock', 'lock v2\n');
    expectRun({ fixture: lockFixture, executed: [...ALL].sort() });

    const envFixture = warmFixture();
    expectRun({ fixture: envFixture, executed: [...ALL].sort(), env: { FIXTURE_GLOBAL: '1' } });
  });
});

describe('inventory and dependency drift', () => {
  test('new test file runs; deleted test file leaves the inventory', () => {
    const fixture = warmFixture();
    fixture.write('tests/k.test.ts', `test('k', () => expect(1).toBe(1));\n`);
    fixture.remove('tests/c.test.ts');
    const summary = expectRun({ fixture, executed: t('k') });
    expect(summary.testFiles).toBe(ALL.length);
  });

  test('added dependency is tracked from the next run on', () => {
    const fixture = warmFixture();
    fixture.write('src/extra.ts', `export const extra = 'x1';\n`);
    fixture.write(
      'tests/b.test.ts',
      `import { extra } from '../src/extra';\ntest('b', () => expect(extra).toBe('x1'));\n`,
    );
    expectRun({ fixture, executed: t('b') });
    // Vitest 5's commit-diff selection misses this case once the import is committed.
    fixture.write('src/extra.ts', `export const extra = 'x2';\n`);
    expectRun({ fixture, executed: t('b'), failed: t('b') });
  });

  test('removed dependency stops invalidating the test', () => {
    const fixture = warmFixture();
    fixture.write('tests/c.test.ts', `test('c', () => expect('shared-v1').toBe('shared-v1'));\n`);
    expectRun({ fixture, executed: t('c') });
    fixture.write('src/shared.ts', `export const shared = 'shared-v2';\n`);
    expectRun({ fixture, executed: t('b'), failed: t('b') });
  });
});

describe('failures and cache damage', () => {
  test('failed results are never reused; reverting restores the cached pass', () => {
    const fixture = warmFixture();
    const original = fixture.read('src/math.ts');
    fixture.write('src/math.ts', 'export const add = () => 0;\n');
    expectRun({ fixture, executed: t('a', 'j'), failed: t('a', 'j') });
    expectRun({ fixture, executed: t('a', 'j'), failed: t('a', 'j') });
    fixture.write('src/math.ts', original);
    expectRun({ fixture, executed: [] });
  });

  test('corrupted or missing cache entries fall back to execution', () => {
    const fixture = warmFixture();
    const entryFor = (test: string) => {
      const name = createHash('sha256').update(`${fixture.rel}/${test}`).digest('hex').slice(0, 24);
      const files = fixture.cacheFiles();
      const found = files.find((file) => file.endsWith(`${name}.json`));
      if (!found) throw new Error(`no cache entry for ${fixture.rel}/${test} (${name}) among ${JSON.stringify(files)}`);
      return found;
    };
    writeFileSync(entryFor('tests/a.test.ts'), '{ not json');
    rmSync(entryFor('tests/b.test.ts'));
    const summary = expectRun({ fixture, executed: t('a', 'b') });
    expect(summary.missReasons).toEqual({ 'corrupt cache entry': 1, 'no cached result': 1 });
  });
});
