const MICROS_PER_SECOND = 1_000_000
const PERCENT = 100

export type PodCgroupCounters = {
  usageUsec: number
  throttledUsec: number
  memoryBytes: number
  memoryLimitBytes: number | null
  oomKills: number
  diskUsedBytes?: number | undefined
  diskLimitBytes?: number | undefined
}

export type PodSample = {
  at: number
  cpuPercent: number
  ramBytes: number
  ramLimitBytes: number | null
  throttled: boolean
  oomKills: number
  diskUsedBytes?: number | undefined
  diskLimitBytes?: number | undefined
}

const grown = (prev: number, next: number): number => Math.max(0, next - prev)

const rounded = (value: number, places: number): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export const podSampleOf = (args: {
  prev: PodCgroupCounters
  next: PodCgroupCounters
  intervalMs: number
  vcpus: number
  at: number
}): PodSample => {
  const seconds = Math.max(args.intervalMs, 1) / 1000
  const cores = grown(args.prev.usageUsec, args.next.usageUsec) / MICROS_PER_SECOND / seconds
  return {
    at: args.at,
    cpuPercent: args.vcpus > 0 ? rounded((cores / args.vcpus) * PERCENT, 1) : 0,
    ramBytes: Math.max(0, args.next.memoryBytes),
    ramLimitBytes: args.next.memoryLimitBytes,
    throttled: grown(args.prev.throttledUsec, args.next.throttledUsec) > 0,
    oomKills: Math.max(0, args.next.oomKills),
    ...(args.next.diskUsedBytes === undefined ? {} : { diskUsedBytes: args.next.diskUsedBytes }),
    ...(args.next.diskLimitBytes === undefined ? {} : { diskLimitBytes: args.next.diskLimitBytes }),
  }
}
