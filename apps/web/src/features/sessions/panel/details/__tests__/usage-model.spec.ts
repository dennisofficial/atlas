import { describe, expect, it } from 'bun:test'

import { cacheHitRateOf } from '../usage-model'

const emptySpend = {
  inputTokens: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
}

describe('cacheHitRateOf', () => {
  it('omits the rate before there are input tokens', () => {
    expect(cacheHitRateOf(null)).toBeNull()
    expect(cacheHitRateOf(emptySpend)).toBeNull()
    expect(cacheHitRateOf({ ...emptySpend, outputTokens: 100 })).toBeNull()
  })

  it('counts cache writes once, inside uncached input', () => {
    expect(
      cacheHitRateOf({
        ...emptySpend,
        inputTokens: 100_000,
        cacheReadTokens: 80_000,
        uncachedInputTokens: 20_000,
        cacheWriteTokens: 15_000,
      }),
    ).toBe(80)
  })

  it('rounds the percentage to a whole number', () => {
    expect(
      cacheHitRateOf({
        ...emptySpend,
        inputTokens: 150_000,
        cacheReadTokens: 100_000,
        uncachedInputTokens: 50_000,
      }),
    ).toBe(67)
  })

  it('shows zero and full cache hit rates', () => {
    expect(cacheHitRateOf({ ...emptySpend, inputTokens: 100, uncachedInputTokens: 100 })).toBe(0)
    expect(cacheHitRateOf({ ...emptySpend, inputTokens: 100, cacheReadTokens: 100 })).toBe(100)
  })
})
