import childProcess from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { mock } from 'bun:test';
import { ENV_NAMES_MARKER, SESSION_ONLY_ENV } from './fingerprint';
import { type Fn, isRecursive, type RecorderContext, toRepoPath, wrap } from './fs-track';
import { createSpawnClassifier } from './spawn';
import { EPathSink } from './types';

const SPAWN_NAMES = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
const MAX_SPAWN_LOG = 20;

type Marking = Fn & { [promisify.custom]?: Fn };

function installFs(context: RecorderContext) {
  const promises = fs.promises;
  const apply = (target: object, names: string[], mode: Parameters<typeof wrap>[0]['mode']) =>
    (sink: (args: unknown[]) => EPathSink) => wrap({ context, target, names, mode, sink });
  const read = () => EPathSink.Files;
  const listing = (args: unknown[]) => (isRecursive(args[1]) ? EPathSink.Trees : EPathSink.Dirs);
  const exists = () => EPathSink.Stats;
  const stat = () => EPathSink.StatInfo;
  const lstat = () => EPathSink.LstatInfo;
  apply(fs, ['readFileSync', 'openSync'], 'sync')(read);
  apply(fs, ['readFile', 'open'], 'callback')(read);
  apply(promises, ['readFile', 'open'], 'promise')(read);
  apply(fs, ['createReadStream'], 'stream')(read);
  apply(fs, ['readdirSync', 'opendirSync'], 'sync')(listing);
  apply(fs, ['readdir', 'opendir'], 'callback')(listing);
  apply(promises, ['readdir', 'opendir'], 'promise')(listing);
  apply(fs, ['existsSync', 'accessSync'], 'sync')(exists);
  apply(fs, ['exists', 'access'], 'callback')(exists);
  apply(promises, ['access'], 'promise')(exists);
  apply(fs, ['statSync'], 'sync')(stat);
  apply(fs, ['stat'], 'callback')(stat);
  apply(promises, ['stat'], 'promise')(stat);
  apply(fs, ['lstatSync'], 'sync')(lstat);
  apply(fs, ['lstat'], 'callback')(lstat);
  apply(promises, ['lstat'], 'promise')(lstat);
}

function installSpawn(context: RecorderContext) {
  const spawns = createSpawnClassifier({
    repoRoot: context.repoRoot,
    recordFile: (path) => context.current()?.paths[EPathSink.Files].add(path),
  });
  const marking = (fn: Fn) =>
    function (this: unknown, ...args: unknown[]) {
      const record = context.current();
      if (record) {
        const verdict = spawns.classify(args);
        if (record.spawned.length < MAX_SPAWN_LOG) record.spawned.push(verdict.command);
        if (verdict.uncacheable) record.markUncacheable('started a child process');
      }
      return fn.apply(this, args);
    };
  const processes = childProcess as unknown as Record<string, Marking | undefined>;
  for (const name of SPAWN_NAMES) {
    const original = processes[name];
    if (!original) continue;
    const wrapper: Marking = marking(original);
    const custom = original[promisify.custom];
    if (custom) Object.defineProperty(wrapper, promisify.custom, { value: marking(custom) });
    processes[name] = wrapper;
  }
  const bun = Bun as unknown as Record<string, unknown>;
  for (const name of ['spawn', 'spawnSync']) {
    const original = bun[name];
    if (typeof original === 'function') bun[name] = marking(original as Fn);
  }
  const shell = bun.$;
  if (typeof shell === 'function') {
    const mark = () => context.current()?.markUncacheable('ran a Bun shell command');
    bun.$ = new Proxy(shell, {
      apply(target, self, args) {
        mark();
        return Reflect.apply(target, self, args);
      },
    });
  }
  const bunFile = bun.file;
  if (typeof bunFile === 'function') {
    bun.file = function (this: unknown, ...args: unknown[]) {
      const path = toRepoPath({ target: args[0], repoRoot: context.repoRoot });
      if (path) context.current()?.paths[EPathSink.Files].add(path);
      return bunFile.apply(this, args);
    };
  }
}

function installEnv(context: RecorderContext) {
  const realEnv = process.env;
  const recordKey = (key: string | symbol) => {
    if (typeof key !== 'string' || SESSION_ONLY_ENV.test(key)) return;
    context.current()?.env.add(key);
  };
  process.env = new Proxy(realEnv, {
    get(target, key) {
      recordKey(key);
      return Reflect.get(target, key);
    },
    set(target, key, value) {
      return Reflect.set(target, key, value);
    },
    has(target, key) {
      recordKey(key);
      return Reflect.has(target, key);
    },
    getOwnPropertyDescriptor(target, key) {
      recordKey(key);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    ownKeys(target) {
      context.current()?.env.add(ENV_NAMES_MARKER);
      return Reflect.ownKeys(target);
    },
  });
  return realEnv;
}

// Bun ignores syncBuiltinESMExports, so named imports of builtins only see the
// wrappers once the builtin modules themselves are replaced by mock.module.
function remockBuiltins() {
  const fsExports = { ...fs, default: fs };
  const promisesExports = { ...fs.promises, default: fs.promises };
  const processExports = { ...childProcess, default: childProcess };
  for (const name of ['node:fs', 'fs']) mock.module(name, () => fsExports);
  for (const name of ['node:fs/promises', 'fs/promises']) mock.module(name, () => promisesExports);
  for (const name of ['node:child_process', 'child_process']) {
    mock.module(name, () => processExports);
  }
}

export function installRecorder(context: RecorderContext) {
  installFs(context);
  installSpawn(context);
  const realEnv = installEnv(context);
  remockBuiltins();
  return realEnv;
}
