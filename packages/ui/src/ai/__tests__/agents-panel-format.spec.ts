import { describe, expect, it } from 'bun:test'

import { compactTokens, formatContext } from '../agents-panel-format'

describe('agents panel format', () => {
  it('formats context as used / window tokens', () => {
    expect(formatContext({ tokens: 87_000, window: 200_000 })).toBe('87k / 200k tokens')
  })

  it('keeps small counts exact', () => {
    expect(compactTokens(850)).toBe('850')
  })

  it('rounds thousands to the nearest k', () => {
    expect(compactTokens(87_400)).toBe('87k')
  })

  it('switches to millions at 1M', () => {
    expect(compactTokens(1_000_000)).toBe('1M')
    expect(formatContext({ tokens: 120_000, window: 1_500_000 })).toBe('120k / 1.5M tokens')
  })
})
