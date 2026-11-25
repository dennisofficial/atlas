import { describe, expect, it } from 'bun:test'

import { COLLAPSED_BODY_HEIGHT, inboundClampOf } from '../components/inbound-clamp'

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
