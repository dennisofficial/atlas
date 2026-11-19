import { describe, expect, test } from 'bun:test'

import { formatTokens } from '../theme'

describe('theme formatTokens', () => {
  test('keeps the k/m/b rendering the tui footer and blocks use', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(179_700)).toBe('179.7k')
    expect(formatTokens(45_840_200)).toBe('45.84m')
    expect(formatTokens(2_500_000_000)).toBe('2.50b')
  })
})
