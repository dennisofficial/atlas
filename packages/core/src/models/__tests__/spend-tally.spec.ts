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

const priced = (costUsd: number): SpendRow => ({
  ...row(),
  costUsd,
  unpricedTokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
})

describe('tallying rows that state their own cost', () => {
  it('adds the stated cost to the catalog price of the unpriced remainder', () => {
    const tally = tallySpend({
      rows: [
        {
          ...row(),
          costUsd: 5,
          unpricedTokens: {
            inputTokens: 100_000,
            outputTokens: 100_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
        },
      ],
      priceOf,
    })

    expect(tally.costUsd).toBeCloseTo(5.3)
    expect(tally.inputTokens).toBe(1_000_000)
  })

  it('takes a fully priced row at its stated cost whatever the catalog later says', () => {
    const rows = [priced(5)]
    const repriced = (): ModelCost => ({ inputPerMillion: 400, outputPerMillion: 800 })

    expect(tallySpend({ rows, priceOf }).costUsd).toBeCloseTo(5)
    expect(tallySpend({ rows, priceOf: repriced }).costUsd).toBeCloseTo(5)
  })

  it('keeps a stated cost when the catalog has no rate for the unpriced remainder', () => {
    const tally = tallySpend({ rows: [priced(5), row({ providerId: 'codex' })], priceOf })

    expect(tally.costUsd).toBeCloseTo(5)
  })

  it('falls back to the catalog for a row recorded with no stated cost', () => {
    expect(tallySpend({ rows: [priced(5), row()], priceOf }).costUsd).toBeCloseTo(8)
  })
})

describe('formatting dollars', () => {
  it('shows sub-cent amounts as a floor', () => {
    expect(formatUsd(0.004)).toBe('<$0.01')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(1.5)).toBe('$1.50')
  })
})
