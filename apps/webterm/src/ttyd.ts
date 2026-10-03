import { chmod, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveConfig } from './config';
import { seedDevHome } from './dev-home';

const TTYD_VERSION = '1.7.7';
const TTYD_RELEASE_BASE = `https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}`;

const config = resolveConfig({ env: process.env, appDir: resolve(import.meta.dir, '..') });

function ttydAssetName(): string {
  if (process.platform !== 'linux') {
    throw new Error(
      `webterm: no prebuilt ttyd for ${process.platform} — install it (e.g. brew install ttyd) and it will be picked up from PATH`,
    );
  }
  if (process.arch === 'x64') return 'ttyd.x86_64';
  if (process.arch === 'arm64') return 'ttyd.aarch64';
  throw new Error(`webterm: unsupported architecture ${process.arch}`);
}

function findSystemTtyd(): string | null {
  const probe = Bun.spawnSync(['sh', '-c', 'command -v ttyd']);
  if (probe.exitCode !== 0) return null;
  const found = probe.stdout.toString().trim();
  return found.length > 0 ? found : null;
}

async function ensureTtyd({ devHome }: { devHome: string }): Promise<string> {
  const system = findSystemTtyd();
  if (system) return system;

  const binaryPath = join(devHome, 'bin', 'ttyd');
  if (existsSync(binaryPath)) return binaryPath;

  const url = `${TTYD_RELEASE_BASE}/${ttydAssetName()}`;
  console.log(`webterm: downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`webterm: ttyd download failed: ${response.status} ${response.statusText}`);
  }
  await mkdir(join(devHome, 'bin'), { recursive: true });
  await Bun.write(binaryPath, response);
  await chmod(binaryPath, 0o755);

  const version = Bun.spawnSync([binaryPath, '--version']);
  if (version.exitCode !== 0) {
    throw new Error(`webterm: downloaded ttyd at ${binaryPath} does not run`);
  }
  return binaryPath;
}

const seed = await seedDevHome({
  sourceHome: config.sourceHome,
  devHome: config.devHome,
  reset: config.resetHome,
});

const ttyd = await ensureTtyd({ devHome: config.devHome });

const args = [
  '-W',
  '-p',
  String(config.port),
  '-i',
  '0.0.0.0',
  '-c',
  `${config.token}:${config.token}`,
  'bash',
  '--rcfile',
  seed.rcFile,
];

console.log('atlas web terminal (ttyd)');
console.log(`  listening:  http://0.0.0.0:${config.port}`);
console.log(`  basic auth: username and password are both the token below`);
console.log(`  token:      ${config.token}`);
console.log(`  dev home:   ${seed.devHome}${seed.hadCredentials ? '' : ' (no credentials found in source home)'}`);

const child = Bun.spawn({
  cmd: [ttyd, ...args],
  stdio: ['inherit', 'inherit', 'inherit'],
  env: {
    ...process.env,
    ATLAS_HOME: config.devHome,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    PATH: `${join(config.repoRoot, 'apps', 'tui', 'bin')}:${process.env.PATH ?? ''}`,
  } as Record<string, string>,
});

const code = await child.exited;
process.exit(code);
