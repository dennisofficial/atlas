/**
 * Vitest setup file added by the incremental plugin. Runs inside the worker
 * for every test file and attaches what that file actually used to the file
 * task's `meta`, which Vitest serializes to the reporter in the main process.
 *
 * Recorded inputs:
 *  - modules: every module Vitest's module runner loaded for this file
 *    (test file, setup files, mocks, transitive and dynamic imports that ran).
 *  - files/dirs/trees/stats/statInfo/lstatInfo: paths used through `node:fs`
 *    (fixtures, source-scanning tests, lockfile readers) — Vitest's own
 *    dependency records miss these. See RecordedInputs for each list.
 *  - env: environment variable names read through `process.env`, plus
 *    ENV_NAMES_MARKER when the test enumerated it.
 *  - uncacheable: set when the file started a child process, whose reads
 *    cannot be seen.
 *
 * Over-recording only costs cache hits; under-recording causes false skips, so
 * every ambiguity here resolves towards recording more.
 */
import childProcess from 'node:child_process';
import { EventEmitter, errorMonitor } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, inject } from 'vitest';
import { ENV_NAMES_MARKER, SESSION_ONLY_ENV } from './fingerprint';
import type {} from './types';

type CachedModule = {
  evaluated?: boolean;
  promise?: unknown;
  exports?: unknown;
  mockedExports?: unknown;
};
type ModuleCache = Map<string, CachedModule> & {
  invalidateModule: (mod: CachedModule) => unknown;
};
type EvaluatedModules = {
  idToModuleMap: Map<string, CachedModule>;
  invalidateModule: (mod: CachedModule) => unknown;
};

// Provided by the plugin rather than an env var: an env var holding the checkout
// path would leak into the env fingerprint of tests that spread process.env.
const REPO_ROOT = inject('incrementalRepoRoot');
const workerState = (
  globalThis as {
    __vitest_worker__?: { moduleCache?: ModuleCache; evaluatedModules?: EvaluatedModules };
  }
).__vitest_worker__;
const moduleCache: ModuleCache | EvaluatedModules | undefined =
  workerState?.moduleCache ?? workerState?.evaluatedModules;

function loadedModuleEntries(cache: ModuleCache | EvaluatedModules) {
  return 'idToModuleMap' in cache ? cache.idToModuleMap : cache;
}

const modules = new Set<string>();
const files = new Set<string>();
const dirs = new Set<string>();
const trees = new Set<string>();
const stats = new Set<string>();
const statInfo = new Set<string>();
const lstatInfo = new Set<string>();
const envKeys = new Set<string>();

function snapshotLoadedModules() {
  if (!moduleCache) return;
  for (const [id, mod] of loadedModuleEntries(moduleCache)) {
    if (mod.evaluated || mod.promise || mod.exports) modules.add(id);
    // Vitest 4 evaluates an automocked module's source under its `mock:` node, so
    // the real path never appears in the registry; its content still feeds the mock.
    if (mod.mockedExports && id.startsWith('mock:')) modules.add(id.slice('mock:'.length));
  }
}

// vi.resetModules() invalidates entries mid-file; capture what was loaded first.
// Vitest 3 calls `invalidateModule`; Vitest 4 clears nodes in place while walking
// `idToModuleMap.forEach` (vitest/dist/chunks/utils resetModules).
if (moduleCache) {
  let pending = false;
  const snapshotOncePerTick = () => {
    if (pending) return;
    pending = true;
    snapshotLoadedModules();
    queueMicrotask(() => (pending = false));
  };
  if ('idToModuleMap' in moduleCache) {
    const idToModuleMap = moduleCache.idToModuleMap;
    const walk = idToModuleMap.forEach.bind(idToModuleMap);
    idToModuleMap.forEach = (callback, thisArg) => {
      snapshotOncePerTick();
      return walk(callback, thisArg);
    };
  }
  const invalidate = moduleCache.invalidateModule.bind(moduleCache);
  moduleCache.invalidateModule = (mod) => {
    snapshotOncePerTick();
    return invalidate(mod);
  };
}

function toRepoPath(target: unknown): string | undefined {
  let path: string | undefined;
  if (typeof target === 'string') path = target;
  else if (target instanceof URL && target.protocol === 'file:') {
    try {
      path = fileURLToPath(target);
    } catch {
      return undefined;
    }
  } else if (Buffer.isBuffer(target)) path = target.toString();
  if (!path || !REPO_ROOT) return undefined;
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  if (!absolute.startsWith(REPO_ROOT + '/')) return undefined;
  if (absolute.includes('/node_modules/') || absolute.includes('/.git/')) return undefined;
  return absolute;
}

/**
 * A path goes to its kind's set only once the call succeeded, i.e. the test saw
 * it existing; a failed call only observed absence (or type), so it goes to
 * `stats`. Operations still in flight when the file finishes count as successes.
 */
const pending = new Set<{ path: string; sink: Set<string> }>();
type Mode = 'sync' | 'callback' | 'promise' | 'stream';
type Fn = (...args: unknown[]) => unknown;

function isRecursive(options: unknown) {
  return typeof options === 'object' && options !== null && 'recursive' in options
    ? Boolean(options.recursive)
    : false;
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

function track(params: {
  original: Fn;
  self: unknown;
  args: unknown[];
  path: string;
  sink: Set<string>;
  mode: Mode;
}) {
  const { original, self, args, path, sink, mode } = params;
  const op = { path, sink };
  const settle = (ok: boolean) => {
    if (pending.delete(op)) (ok ? sink : stats).add(path);
  };
  pending.add(op);
  if (mode === 'callback') {
    let index = args.length - 1;
    while (index >= 0 && typeof args[index] !== 'function') index--;
    const callback = args[index];
    if (typeof callback === 'function') {
      // fs.exists passes a boolean, not an error, but its sink is `stats` either way.
      args[index] = function (this: unknown, ...results: unknown[]) {
        settle(!results[0]);
        return callback.apply(this, results);
      };
    }
  }
  let result: unknown;
  try {
    result = original.apply(self, args);
  } catch (error) {
    settle(false);
    throw error;
  }
  // statSync(path, { throwIfNoEntry: false }) returns undefined for a missing path.
  if (mode === 'sync') settle(result !== undefined);
  if (mode === 'stream' && result instanceof EventEmitter) {
    result.once('open', () => settle(true));
    // errorMonitor observes errors without counting as a handler.
    result.once(errorMonitor, () => settle(false));
  }
  if (mode === 'promise' && isThenable(result)) {
    return result.then(
      (value) => {
        settle(true);
        return value;
      },
      (error: unknown) => {
        settle(false);
        throw error;
      },
    );
  }
  return result;
}

function wrap(params: {
  target: object;
  names: string[];
  mode: Mode;
  sink: (args: unknown[]) => Set<string>;
}) {
  const { target, names, mode, sink } = params;
  const record = target as Record<string | symbol, unknown>;
  for (const name of names) {
    const value = record[name];
    if (typeof value !== 'function') continue;
    const original = value as Fn;
    const wrapper = function (this: unknown, ...args: unknown[]) {
      const path = toRepoPath(args[0]);
      if (!path) return original.apply(this, args);
      return track({ original, self: this, args, path, sink: sink(args), mode });
    };
    // Keeps util.promisify.custom (fs.exists) and similar symbol properties.
    for (const symbol of Object.getOwnPropertySymbols(original)) {
      Object.defineProperty(
        wrapper,
        symbol,
        Object.getOwnPropertyDescriptor(original, symbol) ?? {},
      );
    }
    record[name] = wrapper;
  }
}

// What a child process reads (`git grep`, a script run with node) is invisible
// here, so a test file that starts one is never cached.
let spawned = false;
const marking = (fn: Fn) =>
  function (this: unknown, ...args: unknown[]) {
    spawned = true;
    return fn.apply(this, args);
  };
const processes = childProcess as unknown as Record<string, Fn & { [promisify.custom]?: Fn }>;
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  const original = processes[name];
  if (!original) continue;
  const wrapper = marking(original);
  // util.promisify(exec) calls this instead of exec itself.
  const custom = original[promisify.custom];
  if (custom) Object.defineProperty(wrapper, promisify.custom, { value: marking(custom) });
  processes[name] = wrapper;
}

type BunRuntime = Record<string, unknown> & { file?: Fn; spawn?: Fn; spawnSync?: Fn };
const bun = (globalThis as { Bun?: BunRuntime }).Bun;
if (bun) {
  for (const name of ['spawn', 'spawnSync'] as const) {
    const original = bun[name];
    if (typeof original === 'function') bun[name] = marking(original);
  }
  const bunFile = bun.file;
  if (typeof bunFile === 'function') {
    // Bun.file is lazy: recording the path at creation over-records a file only
    // written or stat-ed, which costs cache hits, never correctness.
    bun.file = function (this: unknown, ...args: unknown[]) {
      const path = toRepoPath(args[0]);
      if (path) files.add(path);
      return bunFile.apply(this, args);
    };
  }
}

const read = () => files;
const listing = (args: unknown[]) => (isRecursive(args[1]) ? trees : dirs);
const exists = () => stats;
const stat = () => statInfo;
const lstat = () => lstatInfo;
const promises = fs.promises;
wrap({ target: fs, names: ['readFileSync', 'openSync'], mode: 'sync', sink: read });
wrap({ target: fs, names: ['readFile', 'open'], mode: 'callback', sink: read });
wrap({ target: promises, names: ['readFile', 'open'], mode: 'promise', sink: read });
wrap({ target: fs, names: ['createReadStream'], mode: 'stream', sink: read });
wrap({ target: fs, names: ['readdirSync', 'opendirSync'], mode: 'sync', sink: listing });
wrap({ target: fs, names: ['readdir', 'opendir'], mode: 'callback', sink: listing });
wrap({ target: promises, names: ['readdir', 'opendir'], mode: 'promise', sink: listing });
wrap({ target: fs, names: ['existsSync', 'accessSync'], mode: 'sync', sink: exists });
wrap({ target: fs, names: ['exists', 'access'], mode: 'callback', sink: exists });
wrap({ target: promises, names: ['access'], mode: 'promise', sink: exists });
wrap({ target: fs, names: ['statSync'], mode: 'sync', sink: stat });
wrap({ target: fs, names: ['stat'], mode: 'callback', sink: stat });
wrap({ target: promises, names: ['stat'], mode: 'promise', sink: stat });
wrap({ target: fs, names: ['lstatSync'], mode: 'sync', sink: lstat });
wrap({ target: fs, names: ['lstat'], mode: 'callback', sink: lstat });
wrap({ target: promises, names: ['lstat'], mode: 'promise', sink: lstat });
syncBuiltinESMExports();

const recordEnvKey = (key: string | symbol) => {
  if (typeof key === 'string' && !SESSION_ONLY_ENV.test(key)) envKeys.add(key);
};

// Only reads are trapped. Writes must reach process.env directly: forwarding a
// set with the proxy as receiver becomes a partial defineProperty, which
// Node's process.env rejects (this broke Next's loadEnvConfig in tests).
const realEnv = process.env;
process.env = new Proxy(realEnv, {
  get(target, key) {
    recordEnvKey(key);
    return Reflect.get(target, key);
  },
  set(target, key, value) {
    return Reflect.set(target, key, value);
  },
  has(target, key) {
    recordEnvKey(key);
    return Reflect.has(target, key);
  },
  getOwnPropertyDescriptor(target, key) {
    recordEnvKey(key);
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
  // Object.keys, spread, for-in: the test saw which variables exist.
  ownKeys(target) {
    envKeys.add(ENV_NAMES_MARKER);
    return Reflect.ownKeys(target);
  },
});

let fileTask: { meta: Record<string, unknown> } | undefined;

beforeAll((suite) => {
  fileTask = suite as unknown as { meta: Record<string, unknown> };
});

// Setup-file hooks are registered first, so with the default 'stack' hook order
// this afterAll runs after the test file's own afterAll hooks.
afterAll(() => {
  snapshotLoadedModules();
  for (const { path, sink } of pending) sink.add(path);
  pending.clear();
  if (!fileTask) return;
  fileTask.meta.incremental = {
    recorderOk: Boolean(moduleCache && REPO_ROOT),
    uncacheable: spawned ? 'started a child process' : undefined,
    modules: [...modules],
    files: [...files],
    dirs: [...dirs],
    trees: [...trees],
    stats: [...stats],
    statInfo: [...statInfo],
    lstatInfo: [...lstatInfo],
    env: [...envKeys],
  };
});
