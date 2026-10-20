// Plain JavaScript on purpose: Vite's config loader leaves package imports
// external, so this file is loaded by Node itself (Node 20 in CI cannot load
// TypeScript). Everything else is TypeScript, loaded by Vitest as a reporter.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPORTER = fileURLToPath(new URL('./src/reporter.ts', import.meta.url));

/** VITEST_INCREMENTAL value (lowercased, trimmed) -> mode; `undefined` means off. */
const ENV_MODES = new Map([
  ['', undefined],
  ['0', undefined],
  ['false', undefined],
  ['1', 'run'],
  ['true', 'run'],
  ['force', 'force'],
  ['plan', 'plan'],
  ['clear', 'clear'],
]);

/** Options that configure the whole Vitest run, so every project must agree on them. */
const SESSION_OPTIONS = /** @type {const} */ (['repoRoot', 'cacheDir', 'summaryFile']);

/** @param {string | undefined} value */
function modeFromEnv(value) {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (ENV_MODES.has(normalized)) return ENV_MODES.get(normalized);
  const valid = [...ENV_MODES.keys()].map((key) => JSON.stringify(key)).join(', ');
  throw new Error(
    `[incremental] Invalid VITEST_INCREMENTAL=${JSON.stringify(value)}. ` +
      `Valid values (case-insensitive): ${valid} or unset.`,
  );
}

/** @param {import('./index').IncrementalTestsOptions} options */
function sessionOptions(options) {
  /** @type {Record<string, string | undefined>} */
  const session = {};
  for (const key of SESSION_OPTIONS) {
    const value = options[key]?.trim();
    // Empty means unset: resolve('') is the cwd, and `clear` deletes cacheDir.
    session[key] = value ? resolve(value) : undefined;
  }
  return session;
}

/** @param {import('./index').IncrementalTestsOptions} [options] */
export function incrementalTests(options = {}) {
  return {
    name: 'dltech:vitest-incremental',
    /** @param {import('vitest/node').VitestPluginContext} context */
    configureVitest({ vitest, project }) {
      const envMode = modeFromEnv(process.env.VITEST_INCREMENTAL);
      if (!(options.enabled ?? envMode !== undefined)) return;
      const session = sessionOptions(options);
      // One reporter per Vitest instance; each project using the plugin opts in
      // with its own options.
      const existing = vitest.config.reporters.find(
        (reporter) => Array.isArray(reporter) && reporter[0] === REPORTER,
      );
      if (!existing) {
        vitest.config.reporters.push([
          REPORTER,
          { ...session, mode: envMode ?? 'run', projects: new Map([[project, options]]) },
        ]);
        return;
      }
      const shared = existing[1];
      for (const key of SESSION_OPTIONS) {
        // Omitted matches anything; only two different explicit values conflict.
        if (session[key] === undefined || shared[key] === session[key]) continue;
        if (shared[key] === undefined) {
          shared[key] = session[key];
          continue;
        }
        throw new Error(
          `[incremental] Conflicting "${key}" for project "${project.name || project.config.root}": ` +
            `${JSON.stringify(session[key])} vs ${JSON.stringify(shared[key])} set by another project. ` +
            `${SESSION_OPTIONS.join(', ')} apply to the whole run; pass the same value to every incrementalTests() call.`,
        );
      }
      shared.projects.set(project, options);
    },
  };
}
