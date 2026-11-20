import { ESandboxCostProvider, rateAt } from './rates'

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const USD_SCALE = 1_000_000_000

/** Vercel bills ~3% above the sandbox's own cgroup clock; an SDK `totalActiveCpuDurationMs` is already billed. */
export const VERCEL_CGROUP_CPU_BILLING_FACTOR = 1.03

export const ceilToMinuteMs = (ms: number): number =>
  Math.ceil(Math.max(0, ms) / MINUTE_MS) * MINUTE_MS

export const roundUsd = (usd: number): number => Math.round(usd * USD_SCALE) / USD_SCALE

export type SandboxRunUsage = {
  provider: ESandboxCostProvider
  vcpus: number
  memoryGb: number
  diskGb: number
  startedAt: number
  endedAt: number
  activeCpuMs?: number | undefined
  awakeMs?: number | undefined
}

const vercelCostOf = (args: {
  usage: SandboxRunUsage
  rates: ReturnType<typeof rateAt> & { provider: ESandboxCostProvider.Vercel }
}): number => {
  const { usage, rates } = args
  const cpu = (rates.activeCpuPerVcpuHourUsd * (usage.activeCpuMs ?? 0)) / HOUR_MS
  const runningMs = ceilToMinuteMs(usage.endedAt - usage.startedAt)
  const memory = (rates.memoryPerGbHourUsd * usage.memoryGb * runningMs) / HOUR_MS
  return cpu + memory
}

const agent37CostOf = (args: {
  usage: SandboxRunUsage
  rates: ReturnType<typeof rateAt> & { provider: ESandboxCostProvider.Agent37 }
}): number => {
  const { usage, rates } = args
  const compute =
    (rates.vcpuPerMonthUsd * usage.vcpus + rates.memoryPerGbMonthUsd * usage.memoryGb) *
    rates.typeMultiplier
  const monthly = compute + rates.diskPerGbMonthUsd * usage.diskGb
  const awakeMs = ceilToMinuteMs(usage.awakeMs ?? usage.endedAt - usage.startedAt)
  return (monthly / rates.monthHours) * (awakeMs / HOUR_MS)
}

export const sandboxRunCostUsd = (usage: SandboxRunUsage): number => {
  const rates = rateAt({ provider: usage.provider, at: usage.endedAt })
  if (rates.provider === ESandboxCostProvider.Vercel)
    return roundUsd(vercelCostOf({ usage, rates }))
  return roundUsd(agent37CostOf({ usage, rates }))
}

export const estimateSandboxRunCostUsd = (args: {
  run: SandboxRunUsage
  now: number
  activeCpuMs?: number | undefined
}): number =>
  sandboxRunCostUsd({
    ...args.run,
    endedAt: args.now,
    activeCpuMs: args.activeCpuMs ?? args.run.activeCpuMs,
    awakeMs: args.run.awakeMs,
  })
