import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CGROUP_ROOT } from './workload-cgroups'

export const CGROUP_V2_CPU_STAT = 'cpu.stat'
export const CGROUP_V1_CPUACCT_USAGE = join('cpuacct', 'cpuacct.usage')
export const NS_PER_USEC = 1_000

const readTextOf = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

const usecOfV2Stat = (text: string): number | undefined => {
  const match = /^usage_usec\s+(\d+)\s*$/m.exec(text)
  if (match?.[1] === undefined) return undefined
  const usec = Number(match[1])
  return Number.isFinite(usec) ? usec : undefined
}

const usecOfV1Usage = (text: string): number | undefined => {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const ns = Number(trimmed)
  return Number.isFinite(ns) ? Math.floor(ns / NS_PER_USEC) : undefined
}

export const cgroupCpuUsecOf = (args: {
  stat: string | undefined
  acctUsage: string | undefined
}): number | undefined => {
  if (args.stat !== undefined) {
    const usec = usecOfV2Stat(args.stat)
    if (usec !== undefined) return usec
  }
  if (args.acctUsage === undefined) return undefined
  return usecOfV1Usage(args.acctUsage)
}

export const readCgroupCpuUsec = (args: {
  root?: string | undefined
  read?: ((path: string) => string | undefined) | undefined
}): number | undefined => {
  const root = args.root ?? CGROUP_ROOT
  const read = args.read ?? readTextOf
  return cgroupCpuUsecOf({
    stat: read(join(root, CGROUP_V2_CPU_STAT)),
    acctUsage: read(join(root, CGROUP_V1_CPUACCT_USAGE)),
  })
}
