# @dltech/vitest-incremental

Vitest plugin that runs only the test files without a cached **passing** result
for their exact current inputs, then records the new passes. Validity is decided
by file content hashes, never by git, branches, commits or mtimes. See
[REPORT.md](./REPORT.md) for the spike's findings, benchmarks and recommendation.

```ts
// vitest.config.ts
import { incrementalTests } from '@dltech/vitest-incremental';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [incrementalTests({ globalInputs: ['packages/tsconfig/**/*.json'] })],
});
```

By default the plugin is inert unless `VITEST_INCREMENTAL` is set, so plain
`vitest` is unchanged; pass `enabled: true` to keep it always on:

```sh
VITEST_INCREMENTAL=1 vitest run       # reuse valid passes
VITEST_INCREMENTAL=force vitest run   # run everything, refresh the cache
VITEST_INCREMENTAL=plan vitest run    # log what would run, run nothing
VITEST_INCREMENTAL=clear vitest run   # delete the cache, then run everything
VITEST_INCREMENTAL=1 VITEST_INCREMENTAL_SUMMARY=out.json vitest run  # also write a JSON run summary
```

Values are case-insensitive. Unset, `''`, `0` and `false` mean off; `1` and
`true` mean reuse; any other value fails at startup. `plan` always exits 0.

Every decision (`run`/`skip` and why) is written to
`.cache/incremental-tests/work/<project>/decisions.log`. File filters and
other reporters keep working; `-t` and line filters run normally but record
nothing. Watch mode and `--shard` should work (the sequencer's `sort` runs on
every rerun, after sharding) but are not verified yet.

Options per project (each `incrementalTests()` call): `enabled`,
`globalInputs` (extra repo-relative globs that invalidate the project's results),
`env` (extra env vars that do the same). Options for the whole run: `repoRoot`
(default: nearest ancestor `package.json` with `workspaces`), `cacheDir`
(default `<repoRoot>/.cache/incremental-tests`), `summaryFile`. A project may
omit them and use another project's value; two different explicit values fail at
startup. Empty strings count as unset.

## How it works

- **Wiring.** `index.js` (plain JS, because Vite's config loader leaves package
  imports to Node) registers `src/reporter.ts` as a Vitest reporter. In
  `onInit` the reporter wraps the configured sequencer, whose `sort` decides
  what the pool runs, and adds `src/recorder.ts` as the first setup file of each
  project that uses the plugin. Public Vitest APIs only.
- **Global key.** Hash of root manifests and lockfiles, every workspace
  package's `package.json`, the project's `tsconfig*.json` and `.env*`, the
  Vitest config and every local
  module it imports, this package's source, `globalInputs`, Vitest/Node version,
  platform and `CI`/`NODE_ENV`/`TZ`/`LANG`/`LC_ALL`/`NODE_OPTIONS` plus `env`.
  Any change selects a fresh cache directory.
- **Validation.** Each test file has up to 4 passing records. Each lists every
  input the test used with its content hash. A record is reused only if every
  input still hashes the same.
- **Recording.** The recorder (worker side) collects modules Vitest loaded for
  the file (including dynamic imports, setup files, `__mocks__` files and
  modules imported by mock factories), paths read through `node:fs`, directory
  listings (including recursive ones), `stat`/`lstat` results, existence
  checks, env var names read, and whether `process.env` was enumerated. Only
  files that passed with no attributed unhandled error and no pass on retry, in
  a run that was not interrupted or filtered, are stored. A file that starts a
  child process is never stored, since what the child reads is invisible. An
  entry is not stored if an input was modified during the run, or if something
  the test saw existing is gone at record time. Cache read, validation and
  write errors fall back to running the test.

```
.cache/incremental-tests/<project>/<globalKey>/<sha256(test path)>.json
{ "schema": 1, "test": "apps/api/src/x.test.tsx",
  "entries": [{ "deps": { "f:apps/api/src/x.tsx": "3fa1…", "d:apps/api/src/dir": "…",
                          "s:apps/api/src/__snapshots__/x.test.tsx.snap": "missing" },
                "envKeys": ["NODE_ENV", …], "envDigest": "…", "passedAt": "…",
                "durationMs": 412, "tests": 7 }] }
```

Dependency keys: `f:` file content, `d:` directory listing (names and entry
types), `r:` recursive listing of a subtree, `m:` `stat` metadata and `l:`
`lstat` metadata (type, size, permission bits, symlink target; never timestamps),
`s:` existence/type only (also used for modules fully replaced by a `vi.mock`
factory and for paths a test found absent). An unreadable file hashes to
`unreadable:<code>`. When a test enumerates `process.env`, its env digest also
covers the set of variable names. Paths are repo-relative, so a cache restored
into a different checkout path still hits.

## Tests and benchmarks

```sh
bun run --filter @dltech/vitest-incremental test                                # fixtures run on bun
VITEST_INCREMENTAL_RUNTIME=node bun run --filter @dltech/vitest-incremental test # fixtures run on node
```

and fails only if a file the cache would have skipped fails.

## Known gaps

- Module resolution shadowing (a new `foo.js` next to `foo.ts`) is not seen.
- `import.meta.glob`: a new file matching the glob is not seen.
- A `globalSetup` file is in the global key; the modules it imports are not.
- Time-, network- or randomness-dependent tests are cached like any other.
- `node_modules` contents are covered only by the lockfile hash, so code
  generated there (such as the Prisma client) needs its sources in
  `globalInputs` (apps/api lists the Prisma schema).
- Tests that enumerate or spread `process.env` rerun whenever any non-session
  variable is added, removed or changed (on CI that is every run, ~2 s here).
- `stat` consumers fingerprint permission bits, so machines with different
  umasks miss for those tests.
- The recorder reads Vitest 3's worker module cache (internal). Vitest 5's
  `experimental.recordDependencies` is the public replacement.

A full suite should keep running on main, nightly and before release.
