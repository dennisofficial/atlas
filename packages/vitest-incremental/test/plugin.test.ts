/**
 * Plugin wiring: env mode parsing, plan mode exit code, per-project options in
 * multi-project configs, session option conflicts, and workspace manifests in
 * the global key. Each case builds its own small fixture with `repoRoot` set to
 * the fixture, so no real repo manifest is involved.
 *
 *   bun test test/plugin.test.ts
 */
import { afterAll, describe, expect, test, vi } from 'vitest'
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { computeGlobalKey } from '../src/global-key';
import { vitestCommand } from './fixture';

vi.setConfig({ testTimeout: 180_000 });

const PACKAGE_DIR = join(import.meta.dirname, '..');
const REPO_ROOT = join(PACKAGE_DIR, '../..');
const PLUGIN = join(PACKAGE_DIR, 'index.js');
const PASSING = `test('ok', () => expect(1).toBe(1));\n`;

interface Summary {
  project: string;
  globalKey: string;
  notRecorded: number;
  testFiles: number;
  reused: number;
  executed: number;
  recorded: number;
  executedFiles: string[];
}

const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

class PluginFixture {
  readonly root = join(PACKAGE_DIR, '.fixture', `plugin-${process.pid}-${created.length}`);
  readonly cacheDir = join(this.root, '.cache');

  constructor(files: Record<string, string>) {
    created.push(this.root);
    rmSync(this.root, { recursive: true, force: true });
    for (const [file, content] of Object.entries(files)) this.write(file, content);
  }

  /** `incrementalTests({...})` call with this fixture's repoRoot/cacheDir plus `extra` (JS source). */
  plugin(extra = '') {
    return `incrementalTests({ repoRoot: ${JSON.stringify(this.root)}, cacheDir: ${JSON.stringify(this.cacheDir)}${extra ? `, ${extra}` : ''} })`;
  }

  config(body: string) {
    this.write(
      'vitest.config.ts',
      `import { incrementalTests } from ${JSON.stringify(PLUGIN)};\nexport default ${body};\n`,
    );
  }

  write(file: string, content: string) {
    mkdirSync(dirname(join(this.root, file)), { recursive: true });
    writeFileSync(join(this.root, file), content);
  }

  run(mode: string) {
    const summaryFile = join(this.root, '.summary.json');
    rmSync(summaryFile, { force: true });
    const [command, args] = vitestCommand(['run']);
    const result = spawnSync(command, args, {
      cwd: this.root,
      encoding: 'utf8',
      env: { ...process.env, VITEST_INCREMENTAL: mode, VITEST_INCREMENTAL_SUMMARY: summaryFile },
    });
    const output = `${result.stdout}\n${result.stderr}`;
    const summaries: Summary[] = existsSync(summaryFile)
      ? [JSON.parse(readFileSync(summaryFile, 'utf8'))].flat()
      : [];
    return { status: result.status, output, summaries };
  }

  /** Runs and expects success; returns `executed` per project name. */
  executed(mode = '1') {
    const { status, output, summaries } = this.run(mode);
    if (status !== 0 || summaries.length === 0) throw new Error(`run failed:\n${output}`);
    return Object.fromEntries(summaries.map((s) => [s.project, s.executed]));
  }
}

/** `test` is extra JS source for the fixture's `test` config. */
function singleProject({
  files = {},
  test = '',
}: { files?: Record<string, string>; test?: string } = {}) {
  const fixture = new PluginFixture({
    'tests/a.test.ts': PASSING,
    'tests/b.test.ts': PASSING,
    ...files,
  });
  // A fixture `package.json` with `workspaces` becomes Vite's fs root; the plugin lives outside it.
  const server = `server: { fs: { allow: [${JSON.stringify(PACKAGE_DIR)}] } }`;
  fixture.config(
    `{ ${server}, plugins: [${fixture.plugin()}], test: { globals: true, include: ['tests/**/*.test.ts']${test ? `, ${test}` : ''} } }`,
  );
  return fixture;
}

describe('VITEST_INCREMENTAL', () => {
  test('plan on a cold cache exits 0 and runs nothing', () => {
    const marker = `import { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\ntest('ran', () => writeFileSync(join(__dirname, '../ran'), ''));\n`;
    const fixture = singleProject({ files: { 'tests/a.test.ts': marker } });
    const { status, output, summaries } = fixture.run('plan');
    expect(status, output).toBe(0);
    expect(summaries[0]).toMatchObject({ testFiles: 2, executed: 2, reused: 0, recorded: 0 });
    expect(existsSync(join(fixture.root, 'ran'))).toBe(false);
  });

  test('values are case-insensitive', () => {
    const fixture = singleProject();
    expect(fixture.executed('TRUE')).toEqual({ '.': 2 });
    // A second TRUE run must reuse everything, so TRUE means "run", not "force".
    expect(fixture.executed('TRUE')).toEqual({ '.': 0 });
    expect(fixture.executed('Force')).toEqual({ '.': 2 });
  });

  test.each(['yes', 'reuse', 'on'])('invalid value %p fails with the valid values', (value) => {
    const fixture = singleProject();
    const { status, output } = fixture.run(value);
    expect(status).not.toBe(0);
    expect(output).toContain(`Invalid VITEST_INCREMENTAL="${value}"`);
    expect(output).toContain('"force", "plan", "clear"');
  });
});

test('a failed cache write is counted as not recorded', () => {
  const fixture = singleProject();
  const globalKey = fixture.run('1').summaries[0]?.globalKey ?? 'missing-summary';
  // Block the store directory (`<cacheDir>/./<globalKey>`) with a plain file.
  rmSync(join(fixture.cacheDir, globalKey), { recursive: true, force: true });
  writeFileSync(join(fixture.cacheDir, globalKey), '');
  const { status, output, summaries } = fixture.run('force');
  expect(status, output).toBe(0);
  expect(summaries[0]).toMatchObject({ executed: 2, recorded: 0, notRecorded: 2 });
  expect(output).toContain('[incremental] not caching tests/a.test.ts: cache write failed');
});

describe('never cached', () => {
  test('a test file that starts a child process', () => {
    const spawns = `import { execFileSync } from 'node:child_process';\ntest('ls', () => expect(execFileSync('ls', [__dirname], { encoding: 'utf8' })).toContain('a.test.ts'));\n`;
    const fixture = singleProject({ files: { 'tests/a.test.ts': spawns } });
    expect(fixture.executed()).toEqual({ '.': 2 });
    expect(fixture.executed()).toEqual({ '.': 1 });
  });

  test('a test file whose test passed only on retry', () => {
    const flaky = `let runs = 0;\ntest('flaky', () => expect(++runs).toBe(2));\n`;
    const fixture = singleProject({ files: { 'tests/a.test.ts': flaky }, test: 'retry: 1' });
    expect(fixture.executed()).toEqual({ '.': 2 });
    expect(fixture.executed()).toEqual({ '.': 1 });
  });
});

test('a globalSetup change invalidates everything', () => {
  const setup = (value: number) => `export default ({ provide }) => provide('value', ${value});\n`;
  const fixture = singleProject({
    files: { 'setup.ts': setup(1) },
    test: `globalSetup: ['./setup.ts']`,
  });
  expect(fixture.executed()).toEqual({ '.': 2 });
  expect(fixture.executed()).toEqual({ '.': 0 });
  fixture.write('setup.ts', setup(2));
  expect(fixture.executed()).toEqual({ '.': 2 });
});

test('clear deletes only a cache directory the plugin created', () => {
  const fixture = singleProject();
  expect(fixture.executed()).toEqual({ '.': 2 });
  expect(fixture.executed('clear')).toEqual({ '.': 2 });
  rmSync(fixture.cacheDir, { recursive: true });
  fixture.write('.cache/keep.txt', 'not a cache\n');
  const { status, output } = fixture.run('clear');
  expect(status).not.toBe(0);
  expect(output).toContain('Refusing to clear');
  expect(existsSync(join(fixture.cacheDir, 'keep.txt'))).toBe(true);
});

describe('multiple projects', () => {
  /** `pluginB` builds project b's plugin call; defaults to the fixture's repoRoot/cacheDir. */
  function twoProjects(pluginB?: (fixture: PluginFixture) => string) {
    const fixture = new PluginFixture({
      'a.lock': 'a1\n',
      'b.lock': 'b1\n',
      'a/tests/a.test.ts': PASSING,
      'b/tests/b.test.ts': PASSING,
    });
    const project = (name: string, plugin: string) =>
      `{ plugins: [${plugin}], test: { name: '${name}', root: './${name}', globals: true, include: ['tests/**/*.test.ts'] } }`;
    const b = pluginB ? pluginB(fixture) : fixture.plugin(`globalInputs: ['b.lock']`);
    fixture.config(
      `{ test: { projects: [${project('a', fixture.plugin(`globalInputs: ['a.lock']`))}, ${project('b', b)}] } }`,
    );
    return fixture;
  }

  test('each project uses its own globalInputs', () => {
    const fixture = twoProjects();
    expect(fixture.executed()).toEqual({ a: 1, b: 1 });
    expect(fixture.executed()).toEqual({ a: 0, b: 0 });
    fixture.write('b.lock', 'b2\n');
    expect(fixture.executed()).toEqual({ a: 0, b: 1 });
    fixture.write('a.lock', 'a2\n');
    expect(fixture.executed()).toEqual({ a: 1, b: 0 });
  });

  test('conflicting cacheDir across projects fails loudly', () => {
    const other = JSON.stringify(join(PACKAGE_DIR, '.fixture', 'unused-other-cache'));
    const fixture = twoProjects(
      (f) =>
        `incrementalTests({ repoRoot: ${JSON.stringify(f.root)}, cacheDir: ${other}, globalInputs: ['b.lock'] })`,
    );
    const { status, output } = fixture.run('1');
    expect(status).not.toBe(0);
    expect(output).toContain('Conflicting "cacheDir"');
  });

  test("a project omitting run-wide options uses the other project's values", () => {
    const fixture = twoProjects(() => `incrementalTests({ globalInputs: ['b.lock'] })`);
    expect(fixture.executed()).toEqual({ a: 1, b: 1 });
    expect(fixture.executed()).toEqual({ a: 0, b: 0 });
    expect(existsSync(fixture.cacheDir)).toBe(true);
  });

  test('empty run-wide options count as unset, so clear never targets the working directory', () => {
    const fixture = twoProjects(
      (f) =>
        `incrementalTests({ repoRoot: ${JSON.stringify(f.root)}, cacheDir: '', summaryFile: '  ', globalInputs: ['b.lock'] })`,
    );
    expect(fixture.executed('clear')).toEqual({ a: 1, b: 1 });
    expect(existsSync(join(fixture.root, 'a/tests/a.test.ts'))).toBe(true);
    expect(fixture.executed()).toEqual({ a: 0, b: 0 });
  });
});

describe('workspace package manifests', () => {
  test('a workspace package manifest change invalidates everything', () => {
    const fixture = singleProject({
      files: {
        'package.json': JSON.stringify({ workspaces: ['libs/*', '!libs/ignored'] }),
        'libs/one/package.json': JSON.stringify({ name: 'one', main: 'index.js' }),
        'libs/ignored/package.json': JSON.stringify({ name: 'ignored' }),
        'libs/one/node_modules/dep/package.json': JSON.stringify({ name: 'dep' }),
      },
    });
    expect(fixture.executed()).toEqual({ '.': 2 });
    expect(fixture.executed()).toEqual({ '.': 0 });
    fixture.write('libs/ignored/package.json', JSON.stringify({ name: 'ignored', main: 'x.js' }));
    fixture.write('libs/one/node_modules/dep/package.json', JSON.stringify({ main: 'x.js' }));
    expect(fixture.executed()).toEqual({ '.': 0 });
    fixture.write('libs/one/package.json', JSON.stringify({ name: 'one', exports: './src.js' }));
    expect(fixture.executed()).toEqual({ '.': 2 });
  });

  test('`{ packages }` workspaces form is honored', () => {
    const fixture = new PluginFixture({
      'package.json': JSON.stringify({ workspaces: { packages: ['libs/*'] } }),
      'libs/one/package.json': JSON.stringify({ name: 'one' }),
    });
    const key = () =>
      computeGlobalKey({
        repoRoot: fixture.root,
        projectRoot: fixture.root,
        pluginDir: PACKAGE_DIR,
        configFiles: [],
        globalInputs: [],
        env: [],
        vitestVersion: 'test',
      }).key;
    const before = key();
    fixture.write('libs/one/package.json', JSON.stringify({ name: 'one', main: 'x.js' }));
    expect(key()).not.toBe(before);
  });
});
