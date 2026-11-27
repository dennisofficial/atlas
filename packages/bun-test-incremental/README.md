# @dltech/bun-test-incremental

A `bun:test` preload that skips a spec file while the inputs it read did not change since its last
passing run. CI uses it to run only the specs that a change can affect. A failure is never cached,
so a red spec always runs again.

## Owns

- The record of the files, directories and environment variables that one spec read.
- The fingerprint of those inputs, and the cached result store.
- The skip decision per spec file.
- The commands that plan, force and clear a run.

## Does not own

- The test runner. Bun runs the specs.
- A path filter or sharding. CI runs the whole selection, and the nightly run uses `force`.
- Test isolation. A spec that leaks state fails on its own.

## Entry points

| Import                                 | Use it for                                                     |
| -------------------------------------- | -------------------------------------------------------------- |
| `@dltech/bun-test-incremental`         | `PRELOAD_PATH`, `loadConfig`, `modeFromEnv`, `EMode`.          |
| `@dltech/bun-test-incremental/preload` | The preload itself. Name it in `bunfig.toml` `[test] preload`. |

The package also installs a binary: `bun-test-incremental <plan|force|clear|run> [bun test args]`.

## Capabilities

### Read the mode

- `EMode`: `Run`, `Force`, `Plan` and `Clear`.
- `modeFromEnv(value)`: the mode of a `BUN_TEST_INCREMENTAL` value, or `undefined` when unset.
- `loadConfig({ env, cwd })`: the resolved `IncrementalConfig`, or `undefined` when the preload
  is inert.
- `PRELOAD_PATH`: the absolute path of the preload, for a wrapper script.

### Run from the command line

- `plan`: print the decision for each spec, and run nothing.
- `force`: run every spec and record the results.
- `clear`: delete the cache directory.
- `run`: run the selection. It passes the other arguments to `bun test`.

## Usage

Add the preload to a package `bunfig.toml`. This is the line in `apps/web/bunfig.toml`.

```toml
[test]
preload = ["../../bun-test.setup.ts", "../../packages/bun-test-incremental/src/preload.ts", "./test-dom-setup.ts"]
```

Then set the mode in the environment.

```sh
BUN_TEST_INCREMENTAL=1 bun test
```

## Rules

- Set `BUN_TEST_INCREMENTAL` to `1` or `true` for an incremental run. `force`, `plan` and
  `clear` select the other modes. The value is case-insensitive. An empty or whitespace-only value
  disables the preload, and so do `0` and `false`. Any other value throws.
- A run with a name filter (`-t`, `--test-name-pattern`, `--only`) is partial. A partial run records
  no result.
- Put an input that sits outside the import graph, such as a fixture schema, in
  `BUN_TEST_INCREMENTAL_GLOBAL_INPUTS`. A change to it changes the global key and reruns everything.
- Put an environment variable name that a spec reads in `BUN_TEST_INCREMENTAL_ENV`, as a
  comma-separated list, to add it to the global key.
- Each passing record is its own file, named by its content. Restoring several copies of the cache
  into one directory, as each CI shard does, therefore never replaces a newer record with a stale
  one. A miss caused by a changed input names the pass it was compared to.
- Keep `BUN_TEST_INCREMENTAL` out of a nested `bun test` that a spec spawns as the thing under test.

## See also

- `.github/workflows/ci.yml` for the CI wiring.
- `packages/bun-test-incremental/__tests__/fixture-run.spec.ts` for the behaviour of each mode.
