import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { EMode } from './types';

const ENV_MODES = new Map<string, EMode | undefined>([
  ['', undefined],
  ['0', undefined],
  ['false', undefined],
  ['1', EMode.Run],
  ['true', EMode.Run],
  ['force', EMode.Force],
  ['plan', EMode.Plan],
  ['clear', EMode.Clear],
]);

export interface IncrementalConfig {
  mode: EMode;
  repoRoot: string;
  projectRoot: string;
  cacheDir: string;
  globalInputs: string[];
  env: string[];
  summaryFile: string | undefined;
}

export function modeFromEnv(value: string | undefined): EMode | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (ENV_MODES.has(normalized)) return ENV_MODES.get(normalized);
  const valid = [...ENV_MODES.keys()].map((key) => JSON.stringify(key)).join(', ');
  throw new Error(
    `[incremental] Invalid BUN_TEST_INCREMENTAL=${JSON.stringify(value)}. ` +
      `Valid values (case-insensitive): ${valid} or unset.`,
  );
}

function findRepoRoot(start: string) {
  for (let dir = start; ; dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && 'workspaces' in JSON.parse(readFileSync(manifest, 'utf8'))) {
      return dir;
    }
    if (dirname(dir) === dir) return start;
  }
}

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function loadConfig(params: {
  env: NodeJS.ProcessEnv;
  cwd: string;
}): IncrementalConfig | undefined {
  const { env, cwd } = params;
  const mode = modeFromEnv(env.BUN_TEST_INCREMENTAL);
  if (mode === undefined) return undefined;
  const repoRoot = env.BUN_TEST_INCREMENTAL_REPO_ROOT?.trim() || findRepoRoot(cwd);
  const cacheDir = env.BUN_TEST_INCREMENTAL_CACHE_DIR?.trim();
  const summaryDir = env.BUN_TEST_INCREMENTAL_SUMMARY_DIR?.trim();
  const root = realpathSync(resolve(repoRoot));
  const projectRoot = realpathSync(cwd);
  const summaryFile =
    env.BUN_TEST_INCREMENTAL_SUMMARY?.trim() ||
    (summaryDir
      ? join(summaryDir, `${relative(root, projectRoot).replace(/[^\w.-]+/g, '-') || 'root'}.json`)
      : undefined);
  return {
    mode,
    repoRoot: root,
    projectRoot,
    cacheDir: cacheDir ? resolve(cacheDir) : join(root, '.cache/incremental-tests'),
    globalInputs: list(env.BUN_TEST_INCREMENTAL_GLOBAL_INPUTS),
    env: list(env.BUN_TEST_INCREMENTAL_ENV),
    summaryFile,
  };
}
