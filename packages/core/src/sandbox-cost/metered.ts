import { roundUsd } from './cost'
import { ESandboxCostSource } from './rates'

export type MeteredRunCandidate = {
  id: string
  startedAt: number
  endedAt: number | null
  costSource: ESandboxCostSource | null
}

export type MeteredRunShare = { id: string; costUsd: number }

const MICROS_PER_USD = 1_000_000

const overlapMs = (args: {
  startedAt: number
  endedAt: number
  windowStart: number
  windowEnd: number
}): number =>
  Math.max(0, Math.min(args.endedAt, args.windowEnd) - Math.max(args.startedAt, args.windowStart))

const measurableOf = (run: MeteredRunCandidate): boolean =>
  run.endedAt !== null && run.costSource !== ESandboxCostSource.Metered

export const meteredRunSharesOf = (args: {
  computeMicros: number
  runs: readonly MeteredRunCandidate[]
  windowStart: number
  windowEnd: number
}): MeteredRunShare[] => {
  const weights = args.runs.filter(measurableOf).map((run) => ({
    id: run.id,
    awakeMs: overlapMs({
      startedAt: run.startedAt,
      endedAt: run.endedAt ?? args.windowEnd,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
    }),
  }))
  const total = weights.reduce((sum, weight) => sum + weight.awakeMs, 0)
  if (total === 0) return []
  const usd = args.computeMicros / MICROS_PER_USD
  return weights.map((weight) => ({
    id: weight.id,
    costUsd: roundUsd((usd * weight.awakeMs) / total),
  }))
}
