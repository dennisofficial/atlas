import { writeFileSync } from 'node:fs'

import { SANDBOX_WORKLOADS_ENV } from './markers'
import type { PriorityStep } from './serve-priority'
import { CGROUP_ROOT, prepareWorkloadCgroups, type WorkloadCgroupsReport } from './workload-cgroups'

export const DAEMON_OOM_SCORE_ADJ = -900

export type DaemonProtectionReport =
  | { enabled: false }
  | { enabled: true; cgroups: WorkloadCgroupsReport; oomScoreAdj: PriorityStep }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const writeSelfOomScoreAdj = (value: number): void =>
  writeFileSync('/proc/self/oom_score_adj', String(value))

/**
 * Snapshot and resume discard the cgroup layout and the oom score, so the daemon applies its
 * policy on every boot instead of trusting its environment to ask for it. The marker written into
 * `env` is what makes `workloadCommand` demote and box every child the daemon spawns later.
 */
export const applyDaemonProtection = (args: {
  env: Record<string, string | undefined>
  platform?: NodeJS.Platform | undefined
  root?: string | undefined
  meminfo?: string | undefined
  writeOomScoreAdj?: ((value: number) => void) | undefined
}): DaemonProtectionReport => {
  const platform = args.platform ?? process.platform
  if (platform !== 'linux') return { enabled: false }
  args.env[SANDBOX_WORKLOADS_ENV] = '1'
  const cgroups = prepareWorkloadCgroups({
    env: args.env,
    platform,
    root: args.root ?? CGROUP_ROOT,
    meminfo: args.meminfo,
  })
  const write = args.writeOomScoreAdj ?? writeSelfOomScoreAdj
  let oomScoreAdj: PriorityStep
  try {
    write(DAEMON_OOM_SCORE_ADJ)
    oomScoreAdj = { applied: true }
  } catch (error) {
    oomScoreAdj = { applied: false, error: messageOf(error) }
  }
  return { enabled: true, cgroups, oomScoreAdj }
}
