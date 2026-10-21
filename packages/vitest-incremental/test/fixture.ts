import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const REPO_ROOT = join(import.meta.dirname, '../../..');
const PLUGIN = join(import.meta.dirname, '../index.js');
const MOCK_PATHS = join(import.meta.dirname, '../../../vitest-setup/mock-paths.ts');
const VITEST = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');

export const RUNTIME = process.env.VITEST_INCREMENTAL_RUNTIME === 'node' ? 'node' : 'bun';

export function vitestCommand(args: string[]): [string, string[]] {
  return RUNTIME === 'node' ? ['node', [VITEST, ...args]] : ['bun', ['--bun', VITEST, ...args]];
}

/**
 * A small Vitest project covering the dependency shapes the runner must track.
 * Each test asserts exact values from its inputs, so breaking an input makes
 * the test fail in a plain full run (the oracle).
 */
const FILES: Record<string, string> = {
  'fixture.lock': 'lock v1\n',
  'setup.ts': `import { SETUP } from './setup-helper';\n(globalThis as any).SETUP = SETUP;\n`,
  'setup-helper.ts': `export const SETUP = 'ok';\n`,
  'src/math.ts': `export const add = (a: number, b: number) => a + b;\n`,
  'src/shared.ts': `export const shared = 'shared-v1';\n`,
  'src/unrelated.ts': `export const unrelated = 1;\n`,
  'src/lazy.ts': `export const lazy = 'lazy-v1';\n`,
  'src/heavy.ts': `export const heavy = 'real';\n`,
  'src/mock-helper.ts': `export const mocked = 'mocked-v1';\n`,
  'src/auto.ts': `export const auto = () => 'real';\n`,
  'src/__mocks__/auto.ts': `export const auto = () => 'manual-mock-v1';\n`,
  'fixtures/data.json': `{ "value": 1 }\n`,
  'fixtures/plugins/one.txt': 'one\n',
  'tests/a.test.ts': `import { add } from '../src/math';\ntest('a', () => expect(add(1, 2)).toBe(3));\n`,
  'tests/b.test.ts': `import { shared } from '../src/shared';\ntest('b', () => expect(shared).toBe('shared-v1'));\n`,
  'tests/c.test.ts': `import { shared } from '../src/shared';\ntest('c', () => expect(shared).toBe('shared-v1'));\n`,
  'tests/d.test.ts': `test('d', async () => {\n  const { lazy } = await import('../src/lazy');\n  expect(lazy).toBe('lazy-v1');\n});\n`,
  'tests/e.test.ts': `import { heavy } from '../src/heavy';\nvi.mock('../src/heavy', async () => ({ heavy: (await import('../src/mock-helper')).mocked }));\ntest('e', () => expect(heavy).toBe('mocked-v1'));\n`,
  'tests/f.test.ts': `import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\ntest('f', () => expect(JSON.parse(readFileSync(join(__dirname, '../fixtures/data.json'), 'utf8')).value).toBe(1));\n`,
  'tests/g.test.ts': `import { readdirSync } from 'node:fs';\nimport { join } from 'node:path';\ntest('g', () => expect(readdirSync(join(__dirname, '../fixtures/plugins'))).toEqual(['one.txt']));\n`,
  // Also writes process.env the ways real code does (Next's loadEnvConfig reassigns existing keys).
  'tests/h.test.ts': `test('h', () => {\n  expect({ ...process.env }).toBeTypeOf('object');\n  process.env.FIXTURE_WRITE = 'x';\n  process.env.FIXTURE_WRITE = 'x2';\n  delete process.env.FIXTURE_WRITE;\n  Object.assign(process.env, { FIXTURE_ASSIGN: 'y' });\n  vi.stubEnv('FIXTURE_STUB', 'z');\n  expect(process.env.FIXTURE_ASSIGN + process.env.FIXTURE_STUB).toBe('yz');\n  expect(process.env.FIXTURE_FLAG ?? 'unset').toBe('unset');\n});\n`,
  'tests/i.test.ts': `import { auto } from '../src/auto';\nvi.mock('../src/auto');\ntest('i', () => expect(auto()).toBe('manual-mock-v1'));\n`,
  'tests/j.test.ts': `test('j', async () => {\n  const { add } = await import('../src/math');\n  expect(add(2, 2)).toBe(4);\n  vi.resetModules();\n  expect((await import('../src/lazy')).lazy).toBe('lazy-v1');\n});\n`,
  'src/plain.ts': `export const plain = () => 'real';\nexport const other = 1;\n`,
  'tests/m.test.ts': `import * as mod from '../src/plain';\nvi.mock('../src/plain');\ntest('m', () => expect(Object.keys(mod).sort()).toEqual(['other', 'plain']));\n`,
  'tests/s.test.ts': `test('s', () => expect((globalThis as any).SETUP).toBe('ok'));\n`,
  'fixtures/tree/a/one.txt': 'one\n',
  'tests/n.test.ts': `import { readdirSync } from 'node:fs';\nimport { join } from 'node:path';\ntest('n', () => expect(readdirSync(join(__dirname, '../fixtures/tree'), { recursive: true }).sort()).toEqual(['a', 'a/one.txt']));\n`,
  'fixtures/typed/x': 'x\n',
  'tests/o.test.ts': `import { readdirSync } from 'node:fs';\nimport { join } from 'node:path';\ntest('o', () => expect(readdirSync(join(__dirname, '../fixtures/typed'), { withFileTypes: true }).map((e) => e.name + (e.isFile() ? ':file' : ':other'))).toEqual(['x:file']));\n`,
  'tests/p.test.ts': `test('p', () => expect(Object.keys(process.env).filter((k) => k.startsWith('FIXTURE_ENUM'))).toEqual([]));\n`,
  'fixtures/ephemeral.txt': 'ephemeral\n',
  // Deletes the file it read once fixtures/delete-me exists.
  'tests/q.test.ts': `import { existsSync, readFileSync, rmSync } from 'node:fs';\nimport { join } from 'node:path';\ntest('q', () => {\n  const file = join(__dirname, '../fixtures/ephemeral.txt');\n  expect(readFileSync(file, 'utf8')).toBe('ephemeral\\n');\n  if (existsSync(join(__dirname, '../fixtures/delete-me'))) rmSync(file);\n});\n`,
  'fixtures/with space/data.txt': 'v1\n',
  'tests/u.test.ts': `import { readFileSync } from 'node:fs';\ntest('u', () => expect(readFileSync(new URL('../fixtures/with space/data.txt', import.meta.url), 'utf8')).toBe('v1\\n'));\n`,
  'tests/v.test.ts': `import { exists } from 'node:fs';\nimport { join } from 'node:path';\ntest('v', async () => {\n  const found = await new Promise((done) => exists(join(__dirname, '../fixtures/maybe.txt'), done));\n  expect(found).toBe(false);\n});\n`,
  'fixtures/sized.bin': 'abcd',
  'fixtures/bun-file.txt': 'bun v1\n',
  'tests/x.test.ts': `import { join } from 'node:path';\ntest('x', async () => {\n  const read = typeof Bun === 'undefined' ? (await import('node:fs')).readFileSync(join(__dirname, '../fixtures/bun-file.txt'), 'utf8') : await Bun.file(join(__dirname, '../fixtures/bun-file.txt')).text();\n  expect(read).toBe('bun v1\\n');\n});\n`,
  'tests/w.test.ts': `import { statSync } from 'node:fs';\nimport { join } from 'node:path';\ntest('w', () => expect(statSync(join(__dirname, '../fixtures/sized.bin')).size).toBe(4));\n`,
};

export interface Summary {
  testFiles: number;
  reused: number;
  executed: number;
  recorded: number;
  executedFiles: string[];
  failedFiles: string[];
  missReasons: Record<string, number>;
}

export class Fixture {
  readonly root: string;
  readonly rel: string;
  private readonly cacheDir: string;

  constructor(name: string) {
    this.root = join(REPO_ROOT, 'packages/vitest-incremental/.fixture', name);
    this.rel = relative(REPO_ROOT, this.root);
    this.cacheDir = join(this.root, '.cache');
    rmSync(this.root, { recursive: true, force: true });
    for (const [file, content] of Object.entries(FILES)) this.write(file, content);
    const plugin = `incrementalTests({ cacheDir: ${JSON.stringify(this.cacheDir)}, globalInputs: [${JSON.stringify(`${this.rel}/fixture.lock`)}], env: ['FIXTURE_GLOBAL'] })`;
    this.write(
      'vitest.config.ts',
      `import { incrementalTests } from ${JSON.stringify(PLUGIN)};\n` +
        `import { absoluteMockPaths } from ${JSON.stringify(MOCK_PATHS)};\n` +
        `export default { plugins: [${plugin}, absoluteMockPaths()], test: { globals: true, include: ['tests/**/*.test.ts'], setupFiles: ['./setup.ts'] } };\n`,
    );
  }

  private vitest(env: Record<string, string | undefined>) {
    const [command, args] = vitestCommand([
      'run',
      ...(env.VITEST_INCREMENTAL
        ? []
        : ['--reporter=json', `--outputFile=${join(this.root, '.full.json')}`]),
    ]);
    return spawnSync(
      command,
      args,
      {
        cwd: this.root,
        encoding: 'utf8',
        env: { ...process.env, ...env },
      },
    );
  }

  write(file: string, content: string) {
    mkdirSync(dirname(join(this.root, file)), { recursive: true });
    writeFileSync(join(this.root, file), content);
  }

  read(file: string) {
    return readFileSync(join(this.root, file), 'utf8');
  }

  remove(file: string) {
    rmSync(join(this.root, file), { force: true });
  }

  /** `vitest run` with the plugin enabled; returns its summary with fixture-relative paths. */
  incremental(env: Record<string, string> = {}): Summary {
    const summaryFile = join(this.root, '.summary.json');
    rmSync(summaryFile, { force: true });
    const result = this.vitest({
      ...env,
      VITEST_INCREMENTAL: '1',
      VITEST_INCREMENTAL_SUMMARY: summaryFile,
    });
    let summary: Summary;
    try {
      summary = JSON.parse(readFileSync(summaryFile, 'utf8'));
    } catch {
      throw new Error(`incremental run produced no summary:\n${result.stdout}\n${result.stderr}`);
    }
    const local = (files: string[]) => files.map((f) => relative(this.rel, f)).sort();
    return {
      ...summary,
      executedFiles: local(summary.executedFiles),
      failedFiles: local(summary.failedFiles),
    };
  }

  /** Oracle: plain `vitest run` (plugin disabled) of the whole fixture; returns the failing test files. */
  fullSuiteFailures(env: Record<string, string> = {}): string[] {
    const out = join(this.root, '.full.json');
    // A stale report from an earlier run must not stand in for a run that crashed.
    rmSync(out, { force: true });
    const result = this.vitest({ ...env, VITEST_INCREMENTAL: undefined });
    let report: { testResults: Array<{ name: string; status: string }> };
    try {
      report = JSON.parse(readFileSync(out, 'utf8'));
    } catch {
      throw new Error(`full run produced no report:\n${result.stdout}\n${result.stderr}`);
    }
    return report.testResults
      .filter((r) => r.status !== 'passed')
      .map((r) => relative(this.root, r.name))
      .sort();
  }

  /** Cache file paths for a test, for corruption scenarios. */
  cacheFiles() {
    const found = spawnSync('find', ['.', '-name', '*.json', '-not', '-path', './work/*'], {
      cwd: this.cacheDir,
      encoding: 'utf8',
    });
    return found.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((file) => join(this.cacheDir, file));
  }
}
