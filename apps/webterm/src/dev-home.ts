import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type DevHomeSeed = {
  devHome: string;
  rcFile: string;
  hadCredentials: boolean;
  copiedCount: number;
};

const COPIED_FILES = [
  'key',
  'auth.json',
  'cloud.json',
  'secrets.json',
  'settings.json',
  'mcp.json',
  'telemetry.json',
  'ATLAS.md',
  'ATLAS.local.md',
  'CLAUDE.md',
];

const COPIED_DIRS = ['memory', 'projects', 'skills'];

async function sourceIsNewer({ source, target }: { source: string; target: string }): Promise<boolean> {
  if (!existsSync(target)) return true;
  const [sourceStat, targetStat] = await Promise.all([stat(source), stat(target)]);
  return sourceStat.mtimeMs > targetStat.mtimeMs;
}

async function copyEntryIfNewer({
  source,
  target,
  copied,
}: {
  source: string;
  target: string;
  copied: string[];
}): Promise<void> {
  const sourceStat = await stat(source);
  if (sourceStat.isDirectory()) {
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await copyEntryIfNewer({
        source: join(source, entry.name),
        target: join(target, entry.name),
        copied,
      });
    }
    return;
  }
  if (!sourceStat.isFile()) return;
  if (!(await sourceIsNewer({ source, target }))) return;
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { preserveTimestamps: true, force: true });
  copied.push(target);
}

function rcContents({ devHome, sourceHome }: { devHome: string; sourceHome: string }): string {
  const escape = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return [
    `PS1='\\[\\e[1;35m\\](webterm)\\[\\e[0m\\] \\w \\$ '`,
    `if [ "\${ATLAS_WEBTERM_AUTOLAUNCH:-1}" != "0" ]; then`,
    `  printf 'webterm: launching atlas-dev — exiting it lands you here\\n'`,
    `  atlas-dev`,
    `fi`,
    `cat <<'EOF'`,
    `atlas web terminal — scratch dev home`,
    `  ATLAS_HOME = ${devHome}`,
    `  credentials seeded from ${sourceHome}`,
    `  reseed from scratch: WEBTERM_RESET_HOME=1`,
    `  plain shell next time: WEBTERM_AUTOLAUNCH=0`,
    `EOF`,
    `export ATLAS_WEBTERM_RC=${escape(join(devHome, 'webterm.rc'))}`,
    ``,
  ].join('\n');
}

export async function seedDevHome({
  sourceHome,
  devHome,
  reset,
}: {
  sourceHome: string;
  devHome: string;
  reset: boolean;
}): Promise<DevHomeSeed> {
  if (sourceHome === devHome) {
    throw new Error(`webterm: source home and dev home are the same path (${devHome}) — refusing to seed`);
  }
  if (reset) {
    await rm(devHome, { recursive: true, force: true });
  }
  await mkdir(devHome, { recursive: true });

  const copied: string[] = [];
  if (existsSync(sourceHome)) {
    for (const name of COPIED_FILES) {
      const source = join(sourceHome, name);
      if (!existsSync(source)) continue;
      await copyEntryIfNewer({ source, target: join(devHome, name), copied });
    }
    for (const name of COPIED_DIRS) {
      const source = join(sourceHome, name);
      if (!existsSync(source)) continue;
      await copyEntryIfNewer({ source, target: join(devHome, name), copied });
    }
  }

  const rcFile = join(devHome, 'webterm.rc');
  await writeFile(rcFile, rcContents({ devHome, sourceHome }), 'utf8');

  const hadCredentials = existsSync(join(devHome, 'key')) && existsSync(join(devHome, 'auth.json'));
  return { devHome, rcFile, hadCredentials, copiedCount: copied.length };
}
