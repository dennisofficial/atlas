import type { SpendTally } from '@dltech/atlas-core'

export function cacheHitRateOf(spend: SpendTally | null): number | null {
  if (spend === null) return null
  const input = spend.cacheReadTokens + spend.uncachedInputTokens
  if (input === 0) return null
  return Math.round((spend.cacheReadTokens / input) * 100)
}
