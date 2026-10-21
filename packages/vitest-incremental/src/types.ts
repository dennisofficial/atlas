/**
 * What the recorder attaches to each test file's task meta. `modules` holds
 * module ids and `env` holds variable names; every other list holds absolute
 * filesystem paths. Every path list except `stats` holds only paths the test
 * observed existing, so one missing at record time means it was deleted during
 * the run.
 */
export interface RecordedInputs {
  recorderOk: boolean;
  /** Why the file must never be cached (it started a child process), if it must not. */
  uncacheable?: string;
  /** argv and cwd of the first child processes the file started. */
  spawned?: string[];
  /** Module ids Vitest loaded; `mock:<path>` for modules replaced by a vi.mock factory. */
  modules: string[];
  /** Files read or opened successfully (`f:` keys). */
  files: string[];
  /** Directories listed non-recursively (`d:` keys). */
  dirs: string[];
  /** Directories listed with `recursive: true` (`r:` keys). */
  trees: string[];
  /** Existence checks and failed reads/stats/listings (`s:` keys). */
  stats: string[];
  /** Successful fs.stat targets (`m:` keys). */
  statInfo: string[];
  /** Successful fs.lstat targets (`l:` keys). */
  lstatInfo: string[];
  /** Env var names read; ENV_NAMES_MARKER if the test enumerated process.env. */
  env: string[];
}

declare module 'vitest' {
  interface ProvidedContext {
    incrementalRepoRoot: string;
  }
}

declare module '@vitest/runner' {
  interface TaskMeta {
    incremental?: RecordedInputs;
  }
}
