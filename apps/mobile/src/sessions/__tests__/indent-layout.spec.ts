import { describe, expect, it } from 'bun:test'

import { INDENT_PER_DEPTH, guideOffsetsOf } from '../indent-layout'

const ICON_CENTER_AT_DEPTH_ZERO = 16

describe('guideOffsetsOf', () => {
  it('draws no guide at the top level', () => {
    expect(guideOffsetsOf(0)).toEqual([])
  })

  it('puts each guide under the status icon of the ancestor at that level', () => {
    expect(guideOffsetsOf(2)).toEqual([
      ICON_CENTER_AT_DEPTH_ZERO,
      ICON_CENTER_AT_DEPTH_ZERO + INDENT_PER_DEPTH,
    ])
  })

  it('keeps the guide clear of the indented row', () => {
    const [guide] = guideOffsetsOf(1)
    expect(guide).toBeLessThan(INDENT_PER_DEPTH)
  })
})
