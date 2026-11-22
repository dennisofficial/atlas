import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { OomMemory } from '@dltech/atlas-core'
import { WORKLOAD_CGROUP_ENV } from '@dltech/atlas-sandbox'

import { METRICS_PROC_ROOT_ENV } from '../metrics/cgroup'

const KIB = 1024
const DEFAULT_PROC_ROOT = '/proc'
const OOM_KILL_LINE = /^oom_kill\s+(\d+)$/
const MEM_TOTAL_LINE = /^MemTotal:\s+(\d+)\s+kB/m

type Env = Record<string, string | undefined>

const textOf = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const procRootOf = (env: Env): string => env[METRICS_PROC_ROOT_ENV] ?? DEFAULT_PROC_ROOT

export const workGroupOf = (env: Env): string | null => {
  const group = env[WORKLOAD_CGROUP_ENV]
  return group === undefined || group === '' ? null : group
}

export const podMemoryBytesOf = (env: Env): number | null => {
  const meminfo = textOf(join(procRootOf(env), 'meminfo'))
  if (meminfo === null) return null
  const match = MEM_TOTAL_LINE.exec(meminfo)
  if (match?.[1] === undefined) return null
  return Number(match[1]) * KIB
}

export const commandLimitBytesOf = (env: Env): number | null => {
  const group = workGroupOf(env)
  if (group === null) return null
  const text = textOf(join(group, 'memory.max'))?.trim()
  if (text === undefined || text === '') return null
  if (text === 'max') return podMemoryBytesOf(env)
  if (!/^\d+$/.test(text)) return null
  return Number(text)
}

export const oomMemoryOf = (env: Env): OomMemory | null => {
  const commandLimitBytes = commandLimitBytesOf(env)
  if (commandLimitBytes === null) return null
  const podBytes = podMemoryBytesOf(env)
  if (podBytes === null) return null
  return { commandLimitBytes, podBytes }
}

export const oomKillTotalOf = (env: Env): number | null => {
  const vmstat = textOf(join(procRootOf(env), 'vmstat'))
  if (vmstat === null) return null
  for (const line of vmstat.split('\n')) {
    const match = OOM_KILL_LINE.exec(line.trim())
    if (match?.[1] !== undefined) return Number(match[1])
  }
  return null
}
