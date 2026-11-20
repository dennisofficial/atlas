import { estimateSandboxRunCostUsd, roundUsd, type SandboxRunUsage } from './cost'
import {
  ESandboxCostProvider,
  rateAt,
  type Agent37SandboxRates,
  type ESandboxCostSource,
} from './rates'

export type SandboxComputeTick = { at: number; rateUsdPerHour: number }

export type SandboxCompute = {
  costUsd: number | null
  running: boolean
  tick: SandboxComputeTick | null
}

export type SandboxRunRow = {
  id: string
  sessionId: string
  userId: string
  provider: ESandboxCostProvider
  sandboxInstanceId: string | null
  vcpus: number
  memoryGb: number
  diskGb: number
  startedAt: number
  endedAt: number | null
  activeCpuMs: number | null
  cpuBaselineMs: number | null
  awakeMs: number | null
  costUsd: number | null
  costSource: ESandboxCostSource | null
}

const HOUR_MS = 3_600_000

const wallClockMonthlyUsd = (row: SandboxRunRow, rates: Agent37SandboxRates): number => {
  const compute = rates.vcpuPerMonthUsd * row.vcpus + rates.memoryPerGbMonthUsd * row.memoryGb
  return compute * rates.typeMultiplier + rates.diskPerGbMonthUsd * row.diskGb
}

export const sandboxWallClockRateUsdPerHour = (args: {
  row: SandboxRunRow
  at: number
}): number => {
  const rates = rateAt({ provider: args.row.provider, at: args.at })
  if (rates.provider === ESandboxCostProvider.Vercel)
    return rates.memoryPerGbHourUsd * args.row.memoryGb
  return wallClockMonthlyUsd(args.row, rates) / rates.monthHours
}

const usageOf = (row: SandboxRunRow, endedAt: number): SandboxRunUsage => ({
  provider: row.provider,
  vcpus: row.vcpus,
  memoryGb: row.memoryGb,
  diskGb: row.diskGb,
  startedAt: row.startedAt,
  endedAt,
  ...(row.activeCpuMs === null ? {} : { activeCpuMs: row.activeCpuMs }),
  ...(row.awakeMs === null ? {} : { awakeMs: row.awakeMs }),
})

const liveCpuMsOf = (args: {
  row: SandboxRunRow
  cumulativeCpuMs: number | undefined
}): number | undefined => {
  if (args.row.activeCpuMs !== null) return undefined
  if (args.cumulativeCpuMs === undefined) return undefined
  return Math.max(0, Math.round(args.cumulativeCpuMs - (args.row.cpuBaselineMs ?? 0)))
}

export const sandboxComputeOf = (args: {
  rows: readonly SandboxRunRow[]
  now: number
  cumulativeCpuMs?: number | undefined
}): SandboxCompute => {
  let total = 0
  let seen = false
  let open: SandboxRunRow | undefined
  for (const row of args.rows) {
    seen = true
    if (row.costUsd !== null) {
      total += row.costUsd
      continue
    }
    if (row.endedAt === null) open = row
    total += estimateSandboxRunCostUsd({
      run: usageOf(row, row.endedAt ?? args.now),
      now: args.now,
      activeCpuMs: liveCpuMsOf({ row, cumulativeCpuMs: args.cumulativeCpuMs }),
    })
  }
  if (!seen) return { costUsd: null, running: false, tick: null }
  return {
    costUsd: roundUsd(total),
    running: open !== undefined,
    tick:
      open === undefined
        ? null
        : {
            at: args.now,
            rateUsdPerHour: sandboxWallClockRateUsdPerHour({ row: open, at: args.now }),
          },
  }
}

export const sandboxComputeAt = (args: {
  compute: SandboxCompute
  now: number
}): SandboxCompute => {
  const { compute } = args
  if (compute.costUsd === null || compute.tick === null) return compute
  const elapsedMs = args.now - compute.tick.at
  if (elapsedMs <= 0) return compute
  const aged = compute.costUsd + (compute.tick.rateUsdPerHour * elapsedMs) / HOUR_MS
  return { ...compute, costUsd: roundUsd(aged) }
}
