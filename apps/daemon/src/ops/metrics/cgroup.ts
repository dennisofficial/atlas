import { readFileSync, statfsSync } from 'node:fs'
import { join } from 'node:path'

import type { PodCgroupCounters } from '@dltech/atlas-core'

export const METRICS_CGROUP_ROOT_ENV = 'ATLAS_DAEMON_CGROUP_ROOT'
export const METRICS_PROC_ROOT_ENV = 'ATLAS_DAEMON_PROC_ROOT'
export const METRICS_DISK_ROOT_ENV = 'ATLAS_DAEMON_DISK_ROOT'
export const SANDBOX_VOLUME_ROOT = '/atlas'

const textOf = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const countersOf = (text: string | null): Map<string, number> => {
  const entries = new Map<string, number>()
  if (text === null) return entries
  for (const line of text.split('\n')) {
    const [key, raw] = line.trim().split(/\s+/)
    if (key === undefined || key === '' || raw === undefined) continue
    const value = Number(raw)
    if (Number.isFinite(value)) entries.set(key, value)
  }
  return entries
}

const wholeOf = (text: string | null): number | null => {
  const trimmed = text?.trim()
  if (trimmed === undefined || !/^\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

type MemoryCounters = { memoryBytes: number; memoryLimitBytes: number | null; oomKills: number }

const KIB = 1024

const cgroupMemoryOf = (root: string): MemoryCounters | null => {
  const memoryBytes = wholeOf(textOf(join(root, 'memory.current')))
  const limitText = textOf(join(root, 'memory.max'))?.trim()
  if (memoryBytes === null || limitText === undefined) return null
  const memoryLimitBytes = limitText === 'max' ? null : wholeOf(limitText)
  if (memoryLimitBytes === null && limitText !== 'max') return null
  const events = countersOf(textOf(join(root, 'memory.events')))
  return { memoryBytes, memoryLimitBytes, oomKills: events.get('oom_kill') ?? 0 }
}

const machineMemoryOf = (proc: string): MemoryCounters | null => {
  const meminfo = new Map<string, number>()
  for (const line of (textOf(join(proc, 'meminfo')) ?? '').split('\n')) {
    const match = /^(\w+):\s+(\d+)/.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) meminfo.set(match[1], Number(match[2]))
  }
  const total = meminfo.get('MemTotal')
  const available = meminfo.get('MemAvailable')
  if (total === undefined || available === undefined) return null
  const vmstat = countersOf(textOf(join(proc, 'vmstat')))
  return {
    memoryBytes: (total - available) * KIB,
    memoryLimitBytes: total * KIB,
    oomKills: vmstat.get('oom_kill') ?? 0,
  }
}

export const readPodCounters = (args: { root: string; proc: string }): PodCgroupCounters | null => {
  const cpu = countersOf(textOf(join(args.root, 'cpu.stat')))
  const usageUsec = cpu.get('usage_usec')
  if (usageUsec === undefined) return null
  const memory = cgroupMemoryOf(args.root) ?? machineMemoryOf(args.proc)
  if (memory === null) return null
  return { usageUsec, throttledUsec: cpu.get('throttled_usec') ?? 0, ...memory }
}

const quotaVcpusOf = (text: string | null): number | null => {
  const [quota, period] = (text ?? '').trim().split(/\s+/)
  if (quota === undefined || period === undefined || quota === 'max') return null
  const used = Number(quota)
  const window = Number(period)
  if (!Number.isFinite(used) || !Number.isFinite(window) || window <= 0) return null
  return Math.max(1, Math.round(used / window))
}

export const podVcpusOf = (args: { root: string; fallback: number }): number =>
  quotaVcpusOf(textOf(join(args.root, 'cpu.max'))) ?? Math.max(1, args.fallback)

export type PodDiskCounters = { diskUsedBytes: number; diskLimitBytes: number }

export const readPodDisk = (args: { root: string }): PodDiskCounters | null => {
  try {
    const stats = statfsSync(args.root)
    return {
      diskUsedBytes: Math.max(0, (stats.blocks - stats.bfree) * stats.bsize),
      diskLimitBytes: stats.blocks * stats.bsize,
    }
  } catch {
    return null
  }
}

export const readFirstPodDisk = (args: { roots: readonly string[] }): PodDiskCounters | null => {
  for (const root of args.roots) {
    const disk = readPodDisk({ root })
    if (disk !== null) return disk
  }
  return null
}
