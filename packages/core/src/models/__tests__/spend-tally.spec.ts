import { describe, expect, it } from 'bun:test'

import type { ModelCost } from '../card'
import { formatUsd, tallySpend, type SpendRow } from '../spend-tally'

const PRICED: ModelCost = { inputPerMillion: 1, outputPerMillion: 2 }

const row = (over: Partial<SpendRow> = {}): SpendRow => ({
  providerId: 'anthropic',
  modelId: 'sonnet',
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...over,
})

const priceOf = (ref: { providerId: string }) =>
  ref.providerId === 'anthropic' ? PRICED : undefined

describe('tallying spend', () => {
  it('prices only the rows that have a rate', () => {
    const tally = tallySpend({ rows: [row(), row({ providerId: 'codex' })], priceOf })

    expect(tally.costUsd).toBe(3)
    expect(tally.inputTokens).toBe(2_000_000)
  })

  it('reports null cost when nothing could be priced', () => {
    expect(tallySpend({ rows: [row({ providerId: 'codex' })], priceOf }).costUsd).toBeNull()
    expect(tallySpend({ rows: [], priceOf }).costUsd).toBeNull()
  })

  it('splits cached reads out of the uncached input', () => {
    const tally = tallySpend({ rows: [row({ cacheReadTokens: 400_000 })], priceOf })

    expect(tally.uncachedInputTokens).toBe(600_000)
    expect(tally.cacheReadTokens).toBe(400_000)
  })
})

describe('formatting dollars', () => {
  it('shows sub-cent amounts as a floor', () => {
    expect(formatUsd(0.004)).toBe('<$0.01')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(1.5)).toBe('$1.50')
  })
})
