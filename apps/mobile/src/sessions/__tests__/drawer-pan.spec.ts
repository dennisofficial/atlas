import { describe, expect, it } from 'bun:test'

import { DRAWER_PAN, tuneDrawerPan } from '../drawer-pan'

const panOf = () => {
  const calls: Record<string, [number, number]> = {}
  return {
    calls,
    activeOffsetX: (range: [number, number]) => {
      calls.activeOffsetX = range
    },
    failOffsetY: (range: [number, number]) => {
      calls.failOffsetY = range
    },
  }
}

describe('tuneDrawerPan', () => {
  it('lets a diagonal thumb swipe from the edge open the drawer', () => {
    const pan = panOf()
    expect(tuneDrawerPan(pan)).toBe(pan)
    expect(pan.calls.failOffsetY).toEqual([-DRAWER_PAN.failOffsetY, DRAWER_PAN.failOffsetY])
    expect(pan.calls.activeOffsetX).toEqual([-DRAWER_PAN.activeOffsetX, DRAWER_PAN.activeOffsetX])
    expect(DRAWER_PAN.failOffsetY).toBeGreaterThan(DRAWER_PAN.activeOffsetX)
  })

  it('leaves a gesture without the builder methods alone', () => {
    const gesture = { kind: 'pan' }
    expect(tuneDrawerPan(gesture)).toBe(gesture)
  })
})
