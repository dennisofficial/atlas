import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedDevHome } from '../dev-home';

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'webterm-dev-home-spec-'));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

function paths() {
  return {
    source: join(sandbox, 'source'),
    target: join(sandbox, 'target', 'webterm'),
  };
}

async function seedWith({ extra }: { extra?: (dir: string) => Promise<void> } = {}) {
  const { source, target } = paths();
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'key'), 'a'.repeat(64), 'utf8');
  await writeFile(join(source, 'auth.json'), '{"version":1}', 'utf8');
  if (extra) await extra(source);
  const seed = await seedDevHome({ sourceHome: source, devHome: target, reset: false });
  return { source, target, seed };
}

describe('seedDevHome', () => {
  it('copies credential files into the dev home', async () => {
    const { target, seed } = await seedWith();
    expect(seed.hadCredentials).toBe(true);
    expect(existsSync(join(target, 'key'))).toBe(true);
    expect(existsSync(join(target, 'auth.json'))).toBe(true);
  });

  it('skips files the source home does not have', async () => {
    const { target } = await seedWith();
    expect(existsSync(join(target, 'cloud.json'))).toBe(false);
    expect(existsSync(join(target, 'settings.json'))).toBe(false);
  });

  it('copies memory and skills trees', async () => {
    const { target } = await seedWith({
      extra: async (source) => {
        await mkdir(join(source, 'memory'), { recursive: true });
        await writeFile(join(source, 'memory', 'MEMORY.md'), '# index', 'utf8');
        await mkdir(join(source, 'skills', 'demo'), { recursive: true });
        await writeFile(join(source, 'skills', 'demo', 'SKILL.md'), 'demo', 'utf8');
      },
    });
    expect(existsSync(join(target, 'memory', 'MEMORY.md'))).toBe(true);
    expect(existsSync(join(target, 'skills', 'demo', 'SKILL.md'))).toBe(true);
  });

  it('leaves files created inside the dev home alone', async () => {
    const { source, target } = paths();
    const first = await seedDevHome({ sourceHome: source, devHome: target, reset: false });
    expect(first.hadCredentials).toBe(false);
    await writeFile(join(target, 'local-note.txt'), 'mine', 'utf8');
    await seedDevHome({ sourceHome: source, devHome: target, reset: false });
    expect(existsSync(join(target, 'local-note.txt'))).toBe(true);
  });

  it('refreshes targets whose source is newer', async () => {
    const { source, target } = await seedWith();
    expect(await readFile(join(target, 'auth.json'), 'utf8')).toBe('{"version":1}');

    const future = new Date(Date.now() + 60_000);
    await writeFile(join(source, 'auth.json'), '{"version":2}', 'utf8');
    await utimes(join(source, 'auth.json'), future, future);

    await seedDevHome({ sourceHome: source, devHome: target, reset: false });
    expect(await readFile(join(target, 'auth.json'), 'utf8')).toBe('{"version":2}');
  });

  it('does not downgrade targets whose source is older', async () => {
    const { source, target } = await seedWith();
    await writeFile(join(target, 'auth.json'), '{"version":9}', 'utf8');

    const past = new Date(Date.now() - 3_600_000);
    await utimes(join(source, 'auth.json'), past, past);

    await seedDevHome({ sourceHome: source, devHome: target, reset: false });
    expect(await readFile(join(target, 'auth.json'), 'utf8')).toBe('{"version":9}');
  });

  it('reset wipes the dev home before seeding', async () => {
    const { source, target } = await seedWith();
    await writeFile(join(target, 'leftover.txt'), 'old', 'utf8');

    await seedDevHome({ sourceHome: source, devHome: target, reset: true });
    expect(existsSync(join(target, 'leftover.txt'))).toBe(false);
    expect(existsSync(join(target, 'key'))).toBe(true);
  });

  it('writes the shell rc file with the home paths', async () => {
    const { target, seed } = await seedWith();
    const rc = await readFile(seed.rcFile, 'utf8');
    expect(rc).toContain(`ATLAS_HOME = ${target}`);
    expect(seed.rcFile.startsWith(target)).toBe(true);
  });

  it('auto-launches atlas-dev unless the flag disables it', async () => {
    const { seed } = await seedWith();
    const rc = await readFile(seed.rcFile, 'utf8');
    expect(rc).toContain('ATLAS_WEBTERM_AUTOLAUNCH');
    expect(rc).toContain('atlas-dev');
  });

  it('boots fine when the source home does not exist', async () => {
    const { target } = paths();
    const seed = await seedDevHome({ sourceHome: join(sandbox, 'missing'), devHome: target, reset: false });
    expect(seed.hadCredentials).toBe(false);
    expect(seed.copiedCount).toBe(0);
    expect(existsSync(join(target, 'webterm.rc'))).toBe(true);
  });

  it('refuses identical source and dev homes', async () => {
    const same = join(sandbox, 'same');
    await expect(seedDevHome({ sourceHome: same, devHome: same, reset: false })).rejects.toThrow('refusing');
  });
});
