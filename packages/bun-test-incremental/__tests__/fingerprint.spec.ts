import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV_NAMES_MARKER, envDigest, Hasher } from '../src/fingerprint';

const root = mkdtempSync(join(tmpdir(), 'bun-test-incremental-fingerprint-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const hash = (key: Parameters<Hasher['hash']>[0]) => new Hasher(root).hash(key);

describe('Hasher', () => {
  test.skipIf(process.getuid?.() === 0)(
    'unreadable file hashes to a sentinel instead of throwing',
    () => {
      writeFileSync(join(root, 'locked.txt'), 'secret');
      chmodSync(join(root, 'locked.txt'), 0);
      expect(hash('f:locked.txt')).toBe('unreadable:EACCES');
      chmodSync(join(root, 'locked.txt'), 0o644);
    },
  );

  test('directory listing covers entry types', () => {
    mkdirSync(join(root, 'listed'));
    writeFileSync(join(root, 'listed/x'), '');
    const asFile = hash('d:listed');
    rmSync(join(root, 'listed/x'));
    mkdirSync(join(root, 'listed/x'));
    expect(hash('d:listed')).not.toBe(asFile);
  });

  test('recursive listing covers nested entries but skips node_modules', () => {
    mkdirSync(join(root, 'tree/a/node_modules'), { recursive: true });
    const before = hash('r:tree');
    writeFileSync(join(root, 'tree/a/node_modules/dep.js'), '');
    expect(hash('r:tree')).toBe(before);
    writeFileSync(join(root, 'tree/a/new.txt'), '');
    expect(hash('r:tree')).not.toBe(before);
  });

  test('stat metadata covers size and mode but not timestamps', () => {
    writeFileSync(join(root, 'sized'), 'abcd');
    const before = hash('m:sized');
    utimesSync(join(root, 'sized'), new Date(0), new Date(0));
    expect(hash('m:sized')).toBe(before);
    chmodSync(join(root, 'sized'), 0o755);
    expect(hash('m:sized')).not.toBe(before);
    expect(hash('s:sized')).toBe('file');
  });
});

describe('envDigest', () => {
  test('the names marker covers new variables except session-only ones', () => {
    const keys = ['A', ENV_NAMES_MARKER];
    const base = envDigest(keys, { A: '1' });
    expect(envDigest(keys, { A: '1', TERM: 'x', SHLVL: '2' })).toBe(base);
    expect(envDigest(keys, { A: '1', B: '' })).not.toBe(base);
    expect(envDigest(['A'], { A: '1', B: '' })).toBe(envDigest(['A'], { A: '1' }));
  });

  test('per-run CI context never invalidates a test that enumerates process.env', () => {
    const keys = ['A', ENV_NAMES_MARKER];
    const base = envDigest(keys, { A: '1', GITHUB_SHA: 'a', RUNNER_TEMP: '/t1', ACTIONS_CACHE_URL: 'u1' });
    expect(envDigest(keys, { A: '1', GITHUB_SHA: 'b', GITHUB_REF: 'r', RUNNER_TEMP: '/t2' })).toBe(base);
  });
});
