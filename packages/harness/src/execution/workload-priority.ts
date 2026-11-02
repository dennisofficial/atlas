import { mirrorsThreadState } from '@dltech/atlas-wire'

import { WORKLOAD_CGROUP_ENV } from './workload-cgroups'

export type WorkloadPolicy = {
  readonly nice: number | null
  readonly oomScoreAdj: number | null
  readonly cgroup: string | null
}

export const WORKLOAD_NICE = 10
export const WORKLOAD_OOM_SCORE_ADJ = 800

const PRELUDE_SHELL = '/bin/sh'
const SAFE_CGROUP_PATH = /^\/[A-Za-z0-9/_-]+$/

export const workloadPolicy = (args: {
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
}): WorkloadPolicy => ({
  nice: args.platform === 'win32' ? null : WORKLOAD_NICE,
  oomScoreAdj:
    args.platform === 'linux' && mirrorsThreadState(args.env) ? WORKLOAD_OOM_SCORE_ADJ : null,
  cgroup: args.platform === 'linux' ? (args.env[WORKLOAD_CGROUP_ENV] ?? null) : null,
})

/**
 * Runs in the child between fork and exec, so the demotion reaches everything the command later
 * forks. The oom write sits in a group because dash prints a failed redirection to the stderr
 * that is current when the redirection is opened. `nice` is relative, so the step raises the
 * child to the target niceness measured from what it inherited rather than stacking on top of a
 * serve that runs below zero. Nothing in it can stop the exec: a failed write is ignored, and a
 * missing `nice` falls through to the bare command.
 */
export const preludeScript = (args: { policy: WorkloadPolicy }): string | null => {
  const { nice, oomScoreAdj, cgroup } = args.policy
  const steps: string[] = []

  if (cgroup !== null) {
    if (!SAFE_CGROUP_PATH.test(cgroup)) return null
    steps.push(
      `{ b=${cgroup}/w-$$; mkdir "$b" && echo 1 > "$b/memory.oom.group"; echo $$ > "$b/cgroup.procs"; } 2>/dev/null`,
    )
  }

  if (oomScoreAdj !== null) {
    if (!Number.isInteger(oomScoreAdj)) return null
    steps.push(`{ echo ${oomScoreAdj} > /proc/self/oom_score_adj; } 2>/dev/null`)
  }
  if (nice !== null) {
    if (!Number.isInteger(nice)) return null
    steps.push(
      `if command -v nice >/dev/null 2>&1; then d=$((${nice} - $(nice 2>/dev/null || echo 0))); [ "$d" -gt 0 ] && exec nice -n "$d" "$@"; fi`,
    )
  }
  if (steps.length === 0) return null

  steps.push('exec "$@"')
  return steps.join('\n')
}

const resolvable = (args: {
  executable: string
  cwd: string | undefined
  env: Record<string, string | undefined> | undefined
}): boolean => {
  const path = args.env?.PATH ?? process.env.PATH
  const found = Bun.which(args.executable, {
    ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
    ...(path === undefined ? {} : { PATH: path }),
  })
  return found !== null
}

export const demotedCommand = (args: {
  cmd: readonly string[]
  cwd?: string | undefined
  env?: Record<string, string | undefined> | undefined
  policy: WorkloadPolicy
}): string[] => {
  const [executable] = args.cmd
  const script = preludeScript({ policy: args.policy })
  if (script === null || executable === undefined) return [...args.cmd]
  if (!resolvable({ executable, cwd: args.cwd, env: args.env })) return [...args.cmd]

  return [PRELUDE_SHELL, '-c', script, 'sh', ...args.cmd]
}

export const workloadCommand = (args: {
  cmd: readonly string[]
  cwd?: string | undefined
  env?: Record<string, string | undefined> | undefined
}): string[] =>
  demotedCommand({
    ...args,
    policy: workloadPolicy({ env: process.env, platform: process.platform }),
  })
