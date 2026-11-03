import { readdirSync, writeFileSync } from 'node:fs'
import { setPriority } from 'node:os'

import {
  DAEMON_OOM_SCORE_ADJ,
  mirrorsThreadState,
  sandboxWorkloadsEnabled,
} from '@dltech/atlas-wire'

export const SERVE_OOM_SCORE_ADJ = -900
export const SERVE_NICE = -5

const SELF_OOM_SCORE_ADJ = '/proc/self/oom_score_adj'
const SELF_TASKS = '/proc/self/task'

export type PriorityStep = { applied: true } | { applied: false; error: string }

export type ServePriorityReport =
  | { enabled: false }
  | { enabled: true; oomScoreAdj: PriorityStep; nice: PriorityStep }

export type ServePriorityDeps = {
  writeOomScoreAdj: (value: number) => void
  setNice: (value: number) => void
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const attempt = (step: () => void): PriorityStep => {
  try {
    step()
    return { applied: true }
  } catch (error) {
    return { applied: false, error: messageOf(error) }
  }
}

/**
 * setpriority(2) on Linux is per thread, so the main thread alone would leave the transport and
 * flush threads at the old priority. Threads created later inherit from their creator.
 */
const setNiceOnEveryThread = (value: number): void => {
  const threads = readdirSync(SELF_TASKS).map(Number)
  for (const thread of threads) setPriority(thread, value)
}

const daemonOomScoreAdj = (env: Record<string, string | undefined>): number => {
  const value = env[DAEMON_OOM_SCORE_ADJ]
  if (value === undefined || value === '') return SERVE_OOM_SCORE_ADJ
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < -1000 || parsed > 1000) return SERVE_OOM_SCORE_ADJ
  return parsed
}

const realDeps: ServePriorityDeps = {
  writeOomScoreAdj: (value) => writeFileSync(SELF_OOM_SCORE_ADJ, String(value)),
  setNice: setNiceOnEveryThread,
}

/**
 * Lowering oom_score_adj and nice below zero needs root (CAP_SYS_RESOURCE / CAP_SYS_NICE); a
 * refusal is reported, never thrown. Workload demotion in the children does not depend on it.
 */
export const applyServePriority = (args: {
  env: Record<string, string | undefined>
  platform?: NodeJS.Platform | undefined
  deps?: ServePriorityDeps | undefined
}): ServePriorityReport => {
  const platform = args.platform ?? process.platform
  const oomScoreAdj = daemonOomScoreAdj(args.env)
  const daemonMarked = sandboxWorkloadsEnabled(args.env)
  if (platform !== 'linux' || !(mirrorsThreadState(args.env) || daemonMarked)) {
    return { enabled: false }
  }
  if (daemonMarked && args.env[DAEMON_OOM_SCORE_ADJ] === undefined) return { enabled: false }

  const deps = args.deps ?? realDeps
  if (daemonMarked) {
    return {
      enabled: true,
      oomScoreAdj: attempt(() => deps.writeOomScoreAdj(oomScoreAdj)),
      nice: { applied: false, error: 'nice skipped below zero' },
    }
  }
  return {
    enabled: true,
    oomScoreAdj: attempt(() => deps.writeOomScoreAdj(SERVE_OOM_SCORE_ADJ)),
    nice: attempt(() => deps.setNice(SERVE_NICE)),
  }
}
