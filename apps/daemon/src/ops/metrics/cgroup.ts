import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PodCgroupCounters } from '@dltech/atlas-core'

export const METRICS_CGROUP_ROOT_ENV = 'ATLAS_DAEMON_CGROUP_ROOT'

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

export const readPodCounters = (root: string): PodCgroupCounters | null => {
  const cpu = countersOf(textOf(join(root, 'cpu.stat')))
  const events = countersOf(textOf(join(root, 'memory.events')))
  const usageUsec = cpu.get('usage_usec')
  const memoryBytes = wholeOf(textOf(join(root, 'memory.current')))
  const limitText = textOf(join(root, 'memory.max'))?.trim()
  if (usageUsec === undefined || memoryBytes === null || limitText === undefined) return null
  const memoryLimitBytes = limitText === 'max' ? null : wholeOf(limitText)
  if (memoryLimitBytes === null && limitText !== 'max') return null
  return {
    usageUsec,
    throttledUsec: cpu.get('throttled_usec') ?? 0,
    memoryBytes,
    memoryLimitBytes,
    oomKills: events.get('oom_kill') ?? 0,
  }
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
