import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PRELOAD_PATH } from '../index';

setDefaultTimeout(60_000);

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

class Fixture {
  readonly root = realpathSync(mkdtempSync(join(tmpdir(), 'bun-test-incremental-')));

  constructor(files: Record<string, string>) {
    roots.push(this.root);
    this.write({ 'package.json': '{ "name": "fx", "private": true, "workspaces": [] }', ...files });
  }

  write(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(this.root, path)), { recursive: true });
      writeFileSync(join(this.root, path), content);
    }
  }

  run(mode: string, args: string[] = []) {
    const summary = join(this.root, 'summary.json');
    const result = Bun.spawnSync(['bun', 'test', '--preload', PRELOAD_PATH, ...args], {
      cwd: this.root,
      env: {
        ...process.env,
        BUN_TEST_INCREMENTAL: mode,
        BUN_TEST_INCREMENTAL_REPO_ROOT: this.root,
        BUN_TEST_INCREMENTAL_CACHE_DIR: join(this.root, '.cache'),
        BUN_TEST_INCREMENTAL_SUMMARY: summary,
      },
    });
    const parsed = JSON.parse(readFileSync(summary, 'utf8'));
    return {
      exitCode: result.exitCode,
      executed: (parsed.executedFiles as string[]).sort(),
      failed: (parsed.failedFiles as string[]).sort(),
      recorded: parsed.recorded as number,
      reused: parsed.reused as number,
      output: result.stdout.toString() + result.stderr.toString(),
    };
  }
}

const spec = (name: string, expected: string) =>
  `import { expect, test } from 'bun:test'\nimport { ${name} } from '../src/${name}'\ntest('${name}', () => { expect(${name}).toBe(${expected}) })\n`;

const abc = () =>
  new Fixture({
    'src/a.ts': 'export const a = 1',
    'src/b.ts': 'export const b = 1',
    'src/c.ts': 'export const c = 1',
    '__tests__/a.spec.ts': spec('a', '1'),
    '__tests__/b.spec.ts': spec('b', '2'),
    '__tests__/c.spec.ts': spec('c', '1'),
  });

const A = '__tests__/a.spec.ts';
const B = '__tests__/b.spec.ts';
const C = '__tests__/c.spec.ts';

describe('incremental pass cache', () => {
  test('caches passes but never a failure, and reruns only what an edit can affect', async () => {
    const fixture = abc();
    const cold = fixture.run('1');
    expect(cold.executed).toEqual([A, B, C]);
    expect(cold.failed).toEqual([B]);
    expect(cold.recorded).toBe(2);
    expect(cold.exitCode).not.toBe(0);

    fixture.write({ 'src/c.ts': 'export const c = 1\nexport const extra = 2' });
    const second = fixture.run('1');
    expect(second.executed).toEqual([B, C]);
    expect(second.reused).toBe(1);

    fixture.write({ 'src/b.ts': 'export const b = 2' });
    const fixed = fixture.run('1');
    expect(fixed.executed).toEqual([B]);
    expect(fixed.failed).toEqual([]);
    expect(fixed.recorded).toBe(1);
    expect(fixed.exitCode).toBe(0);

    const idle = fixture.run('1');
    expect(idle.executed).toEqual([]);
    expect(idle.reused).toBe(3);
    expect(idle.exitCode).toBe(0);
  });

  test('plan decides without running anything and exits 0', () => {
    const fixture = abc();
    fixture.write({ 'src/b.ts': 'export const b = 2' });
    fixture.run('1');
    fixture.write({ 'src/a.ts': 'export const a = 1\nexport const extra = 2' });
    const plan = fixture.run('plan');
    expect(plan.executed).toEqual([A]);
    expect(plan.exitCode).toBe(0);
    expect(plan.output).not.toContain('(pass)');
    expect(fixture.run('1').executed).toEqual([A]);
  });

  test('force runs everything and clear drops the cache first', () => {
    const fixture = abc();
    fixture.write({ 'src/b.ts': 'export const b = 2' });
    fixture.run('1');
    expect(fixture.run('force').executed).toEqual([A, B, C]);
    expect(fixture.run('clear').executed).toEqual([A, B, C]);
  });

  test('a transitive import change reruns the importing spec', () => {
    const fixture = new Fixture({
      'src/leaf.ts': 'export const leaf = 1',
      'src/mid.ts': "export { leaf } from './leaf'",
      '__tests__/deep.spec.ts':
        "import { expect, test } from 'bun:test'\nimport { leaf } from '../src/mid'\ntest('deep', () => { expect(leaf).toBe(1) })\n",
      '__tests__/other.spec.ts': "import { test } from 'bun:test'\ntest('other', () => {})\n",
    });
    fixture.run('1');
    fixture.write({ 'src/leaf.ts': 'export const leaf = 1\n// edit' });
    expect(fixture.run('1').executed).toEqual(['__tests__/deep.spec.ts']);
  });

  test('a runtime fs read and an env read are inputs', () => {
    const fixture = new Fixture({
      'data.txt': 'one',
      '__tests__/reader.spec.ts':
        "import { expect, test } from 'bun:test'\nimport { readFileSync } from 'node:fs'\ntest('reader', () => {\n  expect(readFileSync(`${import.meta.dir}/../data.txt`, 'utf8').length).toBeGreaterThan(0)\n  expect(process.env.FX_FLAG ?? '').toBeString()\n})\n",
    });
    fixture.run('1');
    expect(fixture.run('1').executed).toEqual([]);
    fixture.write({ 'data.txt': 'two' });
    expect(fixture.run('1').executed).toEqual(['__tests__/reader.spec.ts']);
    expect(fixture.run('1').executed).toEqual([]);
    process.env.FX_FLAG = 'on';
    try {
      expect(fixture.run('1').executed).toEqual(['__tests__/reader.spec.ts']);
    } finally {
      delete process.env.FX_FLAG;
    }
  });

  test('a spec that starts a child process is never cached', () => {
    const fixture = new Fixture({
      '__tests__/spawn.spec.ts':
        "import { test } from 'bun:test'\nimport { spawnSync } from 'node:child_process'\ntest('spawn', () => { spawnSync('git', ['status'], { cwd: import.meta.dir }) })\n",
    });
    const cold = fixture.run('1');
    expect(cold.recorded).toBe(0);
    expect(fixture.run('1').executed).toEqual(['__tests__/spawn.spec.ts']);
  });

  test('an async failure after the test body is a failure and is not cached', () => {
    const fixture = new Fixture({
      '__tests__/late.spec.ts':
        "import { test } from 'bun:test'\ntest('late', () => {\n  setTimeout(() => { throw new Error('late') }, 1)\n  return new Promise((resolve) => setTimeout(resolve, 20))\n})\n",
    });
    const cold = fixture.run('1');
    expect(cold.exitCode).not.toBe(0);
    expect(cold.recorded).toBe(0);
  });

  test('a test-name filter runs part of a file so nothing is cached', () => {
    const fixture = abc();
    fixture.write({ 'src/b.ts': 'export const b = 2' });
    expect(fixture.run('1', ['-t', 'a']).recorded).toBe(0);
  });

  test('is inert when BUN_TEST_INCREMENTAL is unset or 0', () => {
    const fixture = abc();
    const result = Bun.spawnSync(['bun', 'test', '--preload', PRELOAD_PATH], {
      cwd: fixture.root,
      env: { ...process.env, BUN_TEST_INCREMENTAL: '0' },
    });
    const output = result.stdout.toString() + result.stderr.toString();
    expect(output).not.toContain('[incremental]');
    expect(output).toContain('(pass) a');
  });
});
