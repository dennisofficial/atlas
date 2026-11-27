import { describe, expect, it } from 'bun:test'

import {
  COLLAPSED_BODY_HEIGHT,
  contentHeightAfter,
  inboundClampOf,
} from '../components/inbound-clamp'

const settle = (layouts: readonly number[]) => {
  let contentHeight = 0
  const clampTrail: boolean[] = []
  for (const layout of layouts) {
    const { clamped } = inboundClampOf({ contentHeight, expanded: false })
    contentHeight = contentHeightAfter({ previous: contentHeight, measured: layout, clamped })
    clampTrail.push(inboundClampOf({ contentHeight, expanded: false }).clamped)
  }
  return clampTrail
}

describe('contentHeightAfter', () => {
  it('stays clamped when the clamp bounds the next layout to the collapsed height', () => {
    expect(settle([600, COLLAPSED_BODY_HEIGHT, COLLAPSED_BODY_HEIGHT, 180])).toEqual([
      true,
      true,
      true,
      true,
    ])
  })

  it('takes the full height again once the body is expanded', () => {
    expect(contentHeightAfter({ previous: 600, measured: 720, clamped: false })).toBe(720)
  })
})

describe('inboundClampOf', () => {
  it('clamps a message taller than the collapsed height', () => {
    expect(inboundClampOf({ contentHeight: COLLAPSED_BODY_HEIGHT + 1, expanded: false })).toEqual({
      overflows: true,
      clamped: true,
    })
  })

  it('keeps the toggle but drops the clamp once expanded', () => {
    expect(inboundClampOf({ contentHeight: COLLAPSED_BODY_HEIGHT * 3, expanded: true })).toEqual({
      overflows: true,
      clamped: false,
    })
  })

  it('leaves a message at or under the collapsed height alone', () => {
    expect(inboundClampOf({ contentHeight: COLLAPSED_BODY_HEIGHT, expanded: false })).toEqual({
      overflows: false,
      clamped: false,
    })
  })
})
