import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { clipRectsOf } from '../native/clip'
import { createMaskSync, OVERLAY_MASKS, overlayStateOf } from '../native/masks'

beforeAll(() => GlobalRegistrator.register())
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

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
  it('masks anchored popovers and the stage clip edges but not modals', () => {
    expect(OVERLAY_MASKS).toContain('[data-slot=dropdown-menu-content]')
    expect(OVERLAY_MASKS).toContain('[data-preview-clip]')
    expect(OVERLAY_MASKS).not.toContain('dialog-content')
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

describe('overlayStateOf', () => {
  const appendSlot = (): HTMLElement => {
    const slot = document.createElement('div')
    document.body.append(slot)
    return slot
  }

  afterAll(() => {
    document.body.innerHTML = ''
  })

  it('keeps the view visible and masks only popovers while one is open', () => {
    const slot = appendSlot()
    const popover = document.createElement('div')
    popover.setAttribute('data-slot', 'popover-content')
    document.body.append(popover)
    const state = overlayStateOf({ root: document, slot })
    expect(state.hidden).toBe(false)
    expect(state.masks).toBe(OVERLAY_MASKS)
    popover.remove()
    slot.remove()
  })

  it('hides the whole view while a dialog, sheet or alert dialog is open', () => {
    const slot = appendSlot()
    for (const modal of ['dialog-content', 'sheet-content', 'alert-dialog-content']) {
      const element = document.createElement('div')
      element.setAttribute('data-slot', modal)
      document.body.append(element)
      expect(overlayStateOf({ root: document, slot }).hidden).toBe(true)
      element.remove()
    }
    slot.remove()
  })

  it('leaves a view inside the modal visible', () => {
    const slot = appendSlot()
    const sheet = document.createElement('div')
    sheet.setAttribute('data-slot', 'sheet-content')
    sheet.append(slot)
    document.body.append(sheet)
    expect(overlayStateOf({ root: document, slot }).hidden).toBe(false)
    expect(overlayStateOf({ root: document, slot: undefined }).hidden).toBe(true)
    sheet.remove()
  })
})
