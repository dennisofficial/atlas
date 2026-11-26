import { describe, expect, it } from 'bun:test'

import { DRAWER_PAN, drawerPanTunerOf, rowSwipeHitSlopOf } from '../drawer-pan'

const panOf = () => {
  const calls: Record<string, unknown> = {}
  return {
    calls,
    activeOffsetX: (range: [number, number]) => {
      calls.activeOffsetX = range
    },
    failOffsetY: (range: [number, number]) => {
      calls.failOffsetY = range
    },
    hitSlop: (slop: { right: number; width: number }) => {
      calls.hitSlop = slop
    },
  }
}

describe('drawerPanTunerOf', () => {
  it('lets a diagonal thumb swipe from the edge open the drawer', () => {
    const pan = panOf()
    expect(drawerPanTunerOf({ open: false })(pan)).toBe(pan)
    expect(pan.calls.failOffsetY).toEqual([-DRAWER_PAN.failOffsetY, DRAWER_PAN.failOffsetY])
    expect(pan.calls.activeOffsetX).toEqual([-DRAWER_PAN.activeOffsetX, DRAWER_PAN.activeOffsetX])
    expect(DRAWER_PAN.failOffsetY).toBeGreaterThan(DRAWER_PAN.activeOffsetX)
    expect(pan.calls.hitSlop).toBeUndefined()
  })

  it('closes an open drawer only from a strip at the right edge', () => {
    const pan = panOf()
    drawerPanTunerOf({ open: true })(pan)
    expect(pan.calls.hitSlop).toEqual({ right: 0, width: DRAWER_PAN.closeEdgeWidth })
  })

  it('leaves a gesture without the builder methods alone', () => {
    const gesture = { kind: 'pan' }
    expect(drawerPanTunerOf({ open: true })(gesture)).toBe(gesture)
  })
})

describe('rowSwipeHitSlopOf', () => {
  it('keeps a row swipe out of the close strip', () => {
    expect(rowSwipeHitSlopOf({ listEdgeInset: 8 })).toEqual({
      right: -(DRAWER_PAN.closeEdgeWidth - 8),
    })
  })

  it('leaves the row whole when the list already clears the strip', () => {
    expect(rowSwipeHitSlopOf({ listEdgeInset: DRAWER_PAN.closeEdgeWidth + 4 }).right).toBe(0)
  })
})
