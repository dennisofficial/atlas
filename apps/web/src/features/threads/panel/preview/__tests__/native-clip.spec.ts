import { describe, expect, it } from 'bun:test'

import { clipRectsOf } from '../native/clip'
import { createMaskSync, OVERLAY_MASKS } from '../native/masks'

describe('clipRectsOf', () => {
  it('covers everything outside the stage with four edge rects', () => {
    const rects = clipRectsOf({
      stage: { left: 100, top: 50, right: 700, bottom: 650 },
      window: { width: 1000, height: 800 },
    })
    expect(rects).toEqual([
      { left: 0, top: 0, width: 1000, height: 50 },
      { left: 0, top: 650, width: 1000, height: 150 },
      { left: 0, top: 50, width: 100, height: 600 },
      { left: 700, top: 50, width: 300, height: 600 },
    ])
  })

  it('never produces negative sizes when the stage spills past the window', () => {
    const rects = clipRectsOf({
      stage: { left: -10, top: -10, right: 1200, bottom: 900 },
      window: { width: 1000, height: 800 },
    })
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThanOrEqual(0)
      expect(rect.height).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('mask sync', () => {
  it('masks menus, popovers and the stage clip edges', () => {
    expect(OVERLAY_MASKS).toContain('[data-slot=dropdown-menu-content]')
    expect(OVERLAY_MASKS).toContain('[data-preview-clip]')
  })

  it('forces a resync only when the overlay signature changes', () => {
    let syncs = 0
    const observe = createMaskSync(() => {
      syncs += 1
    })
    observe('closed')
    observe('closed')
    observe('menu-open')
    observe('menu-open')
    observe('closed')
    expect(syncs).toBe(3)
  })
})
