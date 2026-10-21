import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { globSync } from 'tinyglobby';
import { envDigest, Hasher, sha256 } from './fingerprint';

/** Lockfiles and root manifests: any dependency change invalidates every result. */
const ROOT_INPUTS = [
  'package.json',
  'bun.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'tsconfig.json',
];

const IGNORE = ['**/node_modules/**'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The package.json of every workspace package declared by the root manifest
 * (`workspaces` as an array or `{ packages }`, `!` negations honored): their
 * `exports`/`main`/`imports` steer module resolution for every test.
 */
function workspaceManifests(repoRoot: string): string[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  const declared = isRecord(manifest) ? manifest.workspaces : undefined;
  const list = isRecord(declared) ? declared.packages : declared;
  if (!Array.isArray(list)) return [];
  const toManifest = (glob: string) =>
    `${glob.replace(/^\.\//, '').replace(/\/+$/, '')}/package.json`;
  const globs = list.filter((glob): glob is string => typeof glob === 'string');
  const include = globs.filter((glob) => !glob.startsWith('!')).map(toManifest);
  const negated = globs.filter((glob) => glob.startsWith('!')).map((g) => toManifest(g.slice(1)));
  if (include.length === 0) return [];
  return globSync(include, { cwd: repoRoot, dot: true, ignore: [...IGNORE, ...negated] });
}

const DEFAULT_ENV = ['CI', 'NODE_ENV', 'TZ', 'LANG', 'LC_ALL', 'NODE_OPTIONS'];

/**
 * Hash of everything that invalidates all of a project's results at once:
 * root manifests and lockfiles, workspace package manifests, the project's manifest, tsconfigs and .env
 * files, the Vitest config and every local module it imports (which includes
 * this plugin), the recorder, extra globs, Vitest/Node versions, platform and
 * selected env vars. A change selects a fresh cache directory.
 */
export function computeGlobalKey(params: {
  repoRoot: string;
  projectRoot: string;
  pluginDir: string;
  configFiles: string[];
  globalInputs: string[];
  env: string[];
  vitestVersion: string;
}) {
  const { repoRoot, projectRoot, pluginDir, configFiles, globalInputs, env, vitestVersion } =
    params;
  const project = relative(repoRoot, projectRoot) || '.';
  const plugin = relative(repoRoot, pluginDir);
  const patterns = [
    ...ROOT_INPUTS,
    `${project}/package.json`,
    `${project}/tsconfig*.json`,
    `${project}/.env*`,
    `${plugin}/src/**/*.ts`,
    `${plugin}/*.js`,
    `${plugin}/shims/*.js`,
    ...globalInputs,
  ];
  const files = new Set([
    ...globSync(patterns, { cwd: repoRoot, dot: true, ignore: IGNORE }),
    ...workspaceManifests(repoRoot),
  ]);
  for (const file of configFiles) {
    const rel = isAbsolute(file) ? relative(repoRoot, file) : file;
    if (!rel.startsWith('..') && !rel.includes('node_modules/')) files.add(rel);
  }
  const hasher = new Hasher(repoRoot);
  const parts = [
    'schema=1',
    `project=${project}`,
    `vitest=${vitestVersion}`,
    `node=${process.version}`,
    `platform=${process.platform}-${process.arch}`,
    `env=${envDigest([...DEFAULT_ENV, ...env], process.env)}`,
    ...[...files].sort().map((file) => `${file}=${hasher.hash(`f:${file}`)}`),
  ];
  return { key: sha256(parts.join('\n')), inputs: files.size };
}
