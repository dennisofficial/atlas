import { describe, expect, it } from 'bun:test'

import { rowSpacingOf } from '../session-row-layout'

describe('rowSpacingOf', () => {
  it('keeps the gap between rows at least four times the gap between the lines of one row', () => {
    const { inside, between } = rowSpacingOf()

    expect(between).toBeGreaterThanOrEqual(inside * 4)
  })
})
