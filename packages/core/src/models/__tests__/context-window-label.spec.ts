import { describe, expect, it } from 'bun:test'

import { contextWindowLabel } from '../context-window-label'

describe('contextWindowLabel', () => {
  it.each([
    [0, '0k'],
    [499, '0k'],
    [500, '1k'],
    [8_191, '8k'],
    [128_000, '128k'],
    [128_500, '129k'],
    [999_999, '1000k'],
    [1_000_000, '1M'],
    [1_048_576, '1M'],
    [1_050_000, '1.1M'],
    [1_500_000, '1.5M'],
    [2_000_000, '2M'],
    [10_000_000, '10M'],
  ])('labels %d tokens as %s', (tokens, label) => {
    expect(contextWindowLabel(tokens)).toBe(label)
  })
})
