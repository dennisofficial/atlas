import { describe, expect, it } from 'bun:test'

import { OVERLAY_MIN_WIDTH, OVERLAY_WIDTH_RATIO, overlayWidthOf } from '../sessions-overlay'

describe('overlayWidthOf', () => {
  it('takes a bit over half the window on a Duo unfolded portrait', () => {
    expect(overlayWidthOf(703)).toBe(Math.round(703 * OVERLAY_WIDTH_RATIO))
  })

  it('keeps a wide window to the same ratio', () => {
    expect(overlayWidthOf(1000)).toBe(550)
  })

  it('never drops below the minimum width', () => {
    expect(overlayWidthOf(500)).toBe(OVERLAY_MIN_WIDTH)
  })

  it('never exceeds the window', () => {
    expect(overlayWidthOf(300)).toBe(300)
  })
})
