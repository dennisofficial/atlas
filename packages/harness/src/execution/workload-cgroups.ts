import { mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { mirrorsThreadState } from '@dltech/atlas-wire'

export const CGROUP_ROOT = '/sys/fs/cgroup'
export const WORKLOAD_CGROUP_ENV = 'ATLAS_WORKLOAD_CGROUP'
export const WORK_PIDS_MAX = 16_384
export const WORK_CPU_WEIGHT = 20
export const SERVE_CPU_WEIGHT = 500
export const MIN_SERVE_RESERVE_BYTES = 1.5 * 1024 ** 3
export const SERVE_RESERVE_FRACTION = 0.25
export const BOX_PREFIX = 'w-'
export const MIN_IDLE_BOX_AGE_MS = 10_000

const MOVE_PASSES = 3

export type WorkloadCgroupLimits = {
  pidsMax: number
  memoryMaxBytes: number
  memorySwapMax: number
  cpuWeight: number
  serveCpuWeight: number
}

export type WorkloadCgroupsReport =
  | { enabled: false }
  | { enabled: true; ok: true; workGroup: string; limits: WorkloadCgroupLimits }
  | { enabled: true; ok: false; step: string; error: string }

class StepFailure extends Error {
  constructor(
    readonly step: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
  }
}

const step = <T>(name: string, run: () => T): T => {
  try {
    return run()
  } catch (error) {
    throw new StepFailure(name, error)
  }
}

export const memoryMaxFor = (args: { meminfo: string }): number => {
  const match = /^MemTotal:\s+(\d+)\s+kB/m.exec(args.meminfo)
  if (match?.[1] === undefined) throw new Error('MemTotal not found in meminfo')
  const total = Number(match[1]) * 1024
  return total - Math.max(MIN_SERVE_RESERVE_BYTES, total * SERVE_RESERVE_FRACTION)
}

const write = (args: { path: string; value: string | number }): void =>
  writeFileSync(args.path, String(args.value))

const moveRootProcsInto = (args: { root: string; target: string }): void => {
  for (let pass = 0; pass < MOVE_PASSES; pass++) {
    const pids = readFileSync(join(args.root, 'cgroup.procs'), 'utf8').split('\n').filter(Boolean)
    for (const pid of pids) {
      try {
        write({ path: join(args.target, 'cgroup.procs'), value: pid })
      } catch {}
    }
  }
}

export const prepareWorkloadCgroups = (args: {
  env: Record<string, string | undefined>
  platform?: NodeJS.Platform | undefined
  root?: string | undefined
  meminfo?: string | undefined
}): WorkloadCgroupsReport => {
  const platform = args.platform ?? process.platform
  if (platform !== 'linux' || !mirrorsThreadState(args.env)) return { enabled: false }

  const root = args.root ?? CGROUP_ROOT
  const serveGroup = join(root, 'atlas-serve')
  const workGroup = join(root, 'atlas-work')

  try {
    const memoryMaxBytes = step('size-memory', () =>
      memoryMaxFor({ meminfo: args.meminfo ?? readFileSync('/proc/meminfo', 'utf8') }),
    )
    step('create-groups', () => {
      mkdirSync(serveGroup, { recursive: true })
      mkdirSync(workGroup, { recursive: true })
    })
    step('move-root-procs', () => moveRootProcsInto({ root, target: serveGroup }))
    step('enable-root-controllers', () =>
      write({ path: join(root, 'cgroup.subtree_control'), value: '+cpu +pids +memory' }),
    )
    step('limit-work', () => {
      write({ path: join(workGroup, 'pids.max'), value: WORK_PIDS_MAX })
      write({ path: join(workGroup, 'memory.max'), value: memoryMaxBytes })
      write({ path: join(workGroup, 'memory.swap.max'), value: 0 })
      write({ path: join(workGroup, 'memory.oom.group'), value: 0 })
      write({ path: join(workGroup, 'cpu.weight'), value: WORK_CPU_WEIGHT })
      write({ path: join(serveGroup, 'cpu.weight'), value: SERVE_CPU_WEIGHT })
    })
    step('enable-work-controllers', () =>
      write({ path: join(workGroup, 'cgroup.subtree_control'), value: '+memory +pids' }),
    )

    process.env[WORKLOAD_CGROUP_ENV] = workGroup
    return {
      enabled: true,
      ok: true,
      workGroup,
      limits: {
        pidsMax: WORK_PIDS_MAX,
        memoryMaxBytes,
        memorySwapMax: 0,
        cpuWeight: WORK_CPU_WEIGHT,
        serveCpuWeight: SERVE_CPU_WEIGHT,
      },
    }
  } catch (error) {
    if (error instanceof StepFailure) {
      return { enabled: true, ok: false, step: error.step, error: error.message }
    }
    return {
      enabled: true,
      ok: false,
      step: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export const sweepIdleWorkloadBoxes = (args: {
  root?: string | undefined
  now?: number | undefined
  minAgeMs?: number | undefined
}): void => {
  const workGroup = join(args.root ?? CGROUP_ROOT, 'atlas-work')
  const now = args.now ?? Date.now()
  const minAgeMs = args.minAgeMs ?? MIN_IDLE_BOX_AGE_MS

  let names: string[]
  try {
    names = readdirSync(workGroup).filter((name) => name.startsWith(BOX_PREFIX))
  } catch {
    return
  }
  for (const name of names) {
    const box = join(workGroup, name)
    try {
      if (now - statSync(box).mtimeMs < minAgeMs) continue
      rmdirSync(box)
    } catch {}
  }
}

export const killWorkloadBox = (args: {
  pid: number
  env?: Record<string, string | undefined> | undefined
}): void => {
  const workGroup = (args.env ?? process.env)[WORKLOAD_CGROUP_ENV]
  if (workGroup === undefined || workGroup === '') return
  try {
    write({ path: join(workGroup, `${BOX_PREFIX}${args.pid}`, 'cgroup.kill'), value: 1 })
  } catch {
    return
  }
}
