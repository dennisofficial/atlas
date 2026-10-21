/**
 * What a child process reads is invisible to the recorder, so each spawn is classified by
 * what it can see:
 *  - a program that touches no files (ps, echo), or one whose cwd and arguments all stay
 *    outside the repo (git init in a temp dir), cannot read repo inputs;
 *  - `bun|node <repo script>` reads that script's static import graph, which is recorded;
 *  - anything else makes the test file uncacheable.
 * Runtime reads inside a child script stay invisible; the nightly full run guards that gap.
 */
import fs from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

const readSource = fs.readFileSync.bind(fs);
const realpathSync = fs.realpathSync.bind(fs);

const NO_FILESYSTEM = new Set(['ps', 'true', 'false', 'echo', 'sleep', 'kill', 'id', 'uname', 'which']);
const SCRIPT_RUNNERS = new Set(['bun', 'node']);
const SCRIPT = /\.[cm]?[jt]sx?$/;

type BunGraphApi = {
  Transpiler: new (options: { loader: 'tsx' }) => { scanImports(code: string): Array<{ path: string }> };
  resolveSync(specifier: string, from: string): string;
};

export type SpawnVerdict = { command: string; uncacheable: boolean };

function realpath(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function spawnShape(args: unknown[]) {
  const [first, second, third] = args;
  const options = [first, second, third].find(
    (value): value is { cmd?: unknown; cwd?: unknown } =>
      typeof value === 'object' && value !== null && !Array.isArray(value),
  );
  const raw: unknown[] = Array.isArray(first)
    ? first
    : Array.isArray(options?.cmd)
      ? options.cmd
      : [first, ...(Array.isArray(second) ? second : [])];
  const argv = raw.map(String).flatMap((part) => part.split(/\s+/)).filter(Boolean);
  const cwd = typeof options?.cwd === 'string' ? options.cwd : process.cwd();
  return { argv, cwd };
}

export function createSpawnClassifier(params: {
  repoRoot: string | undefined;
  recordFile: (path: string) => void;
}) {
  const { repoRoot, recordFile } = params;
  const insideRepo = (path: string) =>
    Boolean(repoRoot) && (path === repoRoot || path.startsWith(`${repoRoot}/`));

  const repoPathsIn = (argv: string[], cwd: string) =>
    argv
      .map((token) => token.replace(/^['"]|['"]$/g, '').replace(/^--?[\w-]+=/, ''))
      .filter((token) => token.includes('/') || SCRIPT.test(token))
      .map((token) => (isAbsolute(token) ? token : resolve(cwd, token)))
      .filter(insideRepo);

  const scriptGraph = (entry: string, api: BunGraphApi): string[] | undefined => {
    const transpiler = new api.Transpiler({ loader: 'tsx' });
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      if (!SCRIPT.test(file)) continue;
      let code: string;
      try {
        code = readSource(file, 'utf8');
      } catch {
        return undefined;
      }
      let imports: Array<{ path: string }>;
      try {
        imports = transpiler.scanImports(code);
      } catch {
        return undefined;
      }
      for (const { path } of imports) {
        let resolved: string;
        try {
          resolved = realpath(api.resolveSync(path, dirname(file)));
        } catch {
          continue;
        }
        if (insideRepo(resolved) && !resolved.includes('/node_modules/')) stack.push(resolved);
      }
    }
    return [...seen];
  };

  const classify = (args: unknown[]): SpawnVerdict => {
    try {
      return classifyOrThrow(args);
    } catch {
      return { command: 'unclassifiable spawn', uncacheable: true };
    }
  };

  const classifyOrThrow = (args: unknown[]): SpawnVerdict => {
    const { argv, cwd } = spawnShape(args);
    const command = `${argv.join(' ').slice(0, 300)} @ ${cwd}`;
    const program = basename(argv[0] ?? '');
    if (NO_FILESYSTEM.has(program)) return { command, uncacheable: false };
    const named = repoPathsIn(argv.slice(1), cwd);
    const mentionsRepo = Boolean(repoRoot) && argv.some((token) => token.includes(repoRoot as string));
    if (named.length === 0 && !mentionsRepo && !insideRepo(cwd)) return { command, uncacheable: false };
    const script = named.find((path) => SCRIPT.test(path));
    const api = (globalThis as { Bun?: Partial<BunGraphApi> }).Bun;
    if (SCRIPT_RUNNERS.has(program) && script && api?.Transpiler && api.resolveSync) {
      const graph = scriptGraph(realpath(script), api as BunGraphApi);
      if (graph) {
        for (const file of graph) recordFile(file);
        return { command, uncacheable: false };
      }
    }
    return { command, uncacheable: true };
  };

  return { classify };
}
