import type { VitestPluginContext } from 'vitest/node';

/**
 * `repoRoot`, `cacheDir` and `summaryFile` configure the whole run: every
 * project using the plugin must pass the same value (or omit it everywhere),
 * otherwise Vitest fails at startup. `enabled`, `globalInputs` and `env`
 * apply to the project whose `plugins` contain the call.
 */
export interface IncrementalTestsOptions {
  /** Defaults to whether VITEST_INCREMENTAL selects a mode (see `incrementalTests`). */
  enabled?: boolean;
  /** Paths in the cache are relative to this. Defaults to the nearest ancestor declaring `workspaces`. Same for all projects. */
  repoRoot?: string;
  /** Defaults to `<repoRoot>/.cache/incremental-tests`. Same for all projects. */
  cacheDir?: string;
  /** Extra repo-relative globs whose contents invalidate every result of this project. */
  globalInputs?: string[];
  /** Extra env var names whose values invalidate every result of this project. */
  env?: string[];
  /** Write a JSON run summary here. Defaults to VITEST_INCREMENTAL_SUMMARY. Same for all projects. */
  summaryFile?: string;
}

/**
 * Runs only test files without a cached pass for their exact current inputs.
 * Inert unless VITEST_INCREMENTAL selects a mode (case-insensitive):
 * unset/``/`0`/`false` off, `1`/`true` reuse passes, `force` run all and
 * record, `plan` log decisions without running (always exits 0), `clear`
 * delete the cache first. Any other value throws.
 */
export declare function incrementalTests(options?: IncrementalTestsOptions): {
  name: string;
  configureVitest(context: VitestPluginContext): void;
};
