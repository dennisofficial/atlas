import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { globSync } from 'tinyglobby';
import { envDigest, Hasher, sha256 } from './fingerprint';
import { traceImports } from './import-graph';

const ROOT_INPUTS = [
  'package.json',
  'bun.lock',
  'bun.lockb',
  'bunfig.toml',
  'tsconfig.base.json',
  'tsconfig.json',
];

const IGNORE = ['**/node_modules/**'];
const DEFAULT_ENV = ['CI', 'NODE_ENV', 'TZ', 'LANG', 'LC_ALL', 'NODE_OPTIONS'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function workspaceManifests(repoRoot: string): string[] {
  const manifest = readJson(join(repoRoot, 'package.json'));
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

function preloadInputs(params: { repoRoot: string; projectRoot: string }) {
  const { repoRoot, projectRoot } = params;
  let config: unknown;
  try {
    config = Bun.TOML.parse(readFileSync(join(projectRoot, 'bunfig.toml'), 'utf8'));
  } catch {
    return [];
  }
  const test = isRecord(config) ? config.test : undefined;
  const preload = isRecord(test) ? test.preload : undefined;
  const entries = Array.isArray(preload) ? preload : typeof preload === 'string' ? [preload] : [];
  return entries
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => resolve(projectRoot, entry))
    .flatMap((entry) => traceImports({ entry, repoRoot }));
}

export function computeGlobalKey(params: {
  repoRoot: string;
  projectRoot: string;
  pluginDir: string;
  globalInputs: string[];
  env: string[];
}) {
  const { repoRoot, projectRoot, pluginDir, globalInputs, env } = params;
  const project = relative(repoRoot, projectRoot) || '.';
  const plugin = relative(repoRoot, pluginDir);
  const patterns = [
    ...ROOT_INPUTS,
    `${project}/package.json`,
    `${project}/bunfig.toml`,
    `${project}/tsconfig*.json`,
    `${project}/.env*`,
    ...(plugin.startsWith('..') ? [] : [`${plugin}/src/**/*.ts`, `${plugin}/index.ts`]),
    ...globalInputs,
  ];
  const files = new Set([
    ...globSync(patterns, { cwd: repoRoot, dot: true, ignore: IGNORE }),
    ...workspaceManifests(repoRoot),
  ]);
  for (const path of preloadInputs({ repoRoot, projectRoot })) {
    const rel = isAbsolute(path) ? relative(repoRoot, path) : path;
    if (!rel.startsWith('..') && !rel.includes('node_modules/')) files.add(rel);
  }
  const hasher = new Hasher(repoRoot);
  const parts = [
    'schema=1',
    `project=${project}`,
    `bun=${Bun.version}`,
    `platform=${process.platform}-${process.arch}`,
    `env=${envDigest([...DEFAULT_ENV, ...env], process.env)}`,
    ...[...files].sort().map((file) => `${file}=${hasher.hash(`f:${file}`)}`),
  ];
  return { key: sha256(parts.join('\n')), inputs: files.size };
}
