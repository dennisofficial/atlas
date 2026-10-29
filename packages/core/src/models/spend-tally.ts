import { estimateCostUsd, type TokenSpend } from './cost'
import type { ModelCost } from './card'
import type { ModelRef } from './ref'

export type SpendRow = TokenSpend & ModelRef

export type SpendTally = TokenSpend & {
  uncachedInputTokens: number
  costUsd: number | null
}

export function tallySpend(args: {
  rows: readonly SpendRow[]
  priceOf: (ref: ModelRef) => ModelCost | undefined
}): SpendTally {
  let costUsd: number | null = null
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0

  for (const row of args.rows) {
    inputTokens += row.inputTokens
    outputTokens += row.outputTokens
    cacheReadTokens += row.cacheReadTokens
    cacheWriteTokens += row.cacheWriteTokens

    const cost = args.priceOf({ providerId: row.providerId, modelId: row.modelId })
    if (cost === undefined) continue

    costUsd = (costUsd ?? 0) + estimateCostUsd({ spend: row, cost })
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    uncachedInputTokens: inputTokens - cacheReadTokens,
    costUsd,
  }
}

const CENT = 0.01

export const formatUsd = (dollars: number): string =>
  dollars > 0 && dollars < CENT ? `<$${CENT.toFixed(2)}` : `$${dollars.toFixed(2)}`
