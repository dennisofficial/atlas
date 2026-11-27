import { describe, expect, it } from 'bun:test'

import {
  DROPDOWN_GAP,
  DROPDOWN_MARGIN,
  DROPDOWN_MIN_HEIGHT,
  DROPDOWN_WIDTH,
  dropdownPlacementOf,
  EDropdownSide,
} from '../dropdown-placement'

const DUO_CLOSED = { width: 466, height: 678 }
const DUO_INSETS = { top: 62, right: 75, bottom: 34, left: 0 }
const COMPOSER_TRIGGER = { x: 80, y: 600, width: 80, height: 28 }

describe('dropdownPlacementOf', () => {
  it('opens a bottom trigger upwards with its bottom edge just above the trigger', () => {
    const placement = dropdownPlacementOf({
      anchor: COMPOSER_TRIGGER,
      window: DUO_CLOSED,
      insets: DUO_INSETS,
      keyboardInset: 0,
    })
    expect(placement.side).toBe(EDropdownSide.Above)
    expect(placement.edge).toEqual({ bottom: DUO_CLOSED.height - (600 - DROPDOWN_GAP) })
    expect(placement.maxHeight).toBe(600 - DROPDOWN_GAP - 62 - DROPDOWN_MARGIN)
  })

  it('lines its leading edge up with the trigger', () => {
    const placement = dropdownPlacementOf({
      anchor: COMPOSER_TRIGGER,
      window: { width: 890, height: 626 },
      insets: { top: 24, right: 80, bottom: 21, left: 0 },
      keyboardInset: 0,
    })
    expect(placement.left).toBe(80)
    expect(placement.width).toBe(DROPDOWN_WIDTH)
  })

  it('keeps clear of the duo status column on the right', () => {
    const placement = dropdownPlacementOf({
      anchor: { x: 300, y: 600, width: 80, height: 28 },
      window: DUO_CLOSED,
      insets: DUO_INSETS,
      keyboardInset: 0,
    })
    expect(placement.left + placement.width).toBe(DUO_CLOSED.width - 75 - DROPDOWN_MARGIN)
  })

  it('rises above the keyboard once the search field brings it up', () => {
    const placement = dropdownPlacementOf({
      anchor: COMPOSER_TRIGGER,
      window: DUO_CLOSED,
      insets: DUO_INSETS,
      keyboardInset: 300,
    })
    expect(placement.side).toBe(EDropdownSide.Above)
    expect(placement.edge).toEqual({ bottom: 300 + DROPDOWN_MARGIN })
    expect(placement.maxHeight).toBe(
      DUO_CLOSED.height - 300 - DROPDOWN_MARGIN - 62 - DROPDOWN_MARGIN,
    )
  })

  it('opens a top trigger downwards', () => {
    const placement = dropdownPlacementOf({
      anchor: { x: 200, y: 120, width: 120, height: 28 },
      window: { width: 440, height: 956 },
      insets: { top: 62, right: 0, bottom: 34, left: 0 },
      keyboardInset: 0,
    })
    expect(placement.side).toBe(EDropdownSide.Below)
    expect(placement.edge).toEqual({ top: 120 + 28 + DROPDOWN_GAP })
    expect(placement.maxHeight).toBe(956 - 34 - DROPDOWN_MARGIN - (148 + DROPDOWN_GAP))
  })

  it('moves a downward dropdown up to keep room above the keyboard', () => {
    const placement = dropdownPlacementOf({
      anchor: { x: 200, y: 300, width: 120, height: 28 },
      window: { width: 440, height: 956 },
      insets: { top: 62, right: 0, bottom: 34, left: 0 },
      keyboardInset: 500,
    })
    const floor = 956 - 500 - DROPDOWN_MARGIN
    expect(placement.edge).toEqual({ top: floor - DROPDOWN_MIN_HEIGHT })
    expect(placement.maxHeight).toBe(DROPDOWN_MIN_HEIGHT)
  })

  it('narrows to the window on a small screen', () => {
    const placement = dropdownPlacementOf({
      anchor: COMPOSER_TRIGGER,
      window: { width: 300, height: 600 },
      insets: { top: 20, right: 0, bottom: 0, left: 0 },
      keyboardInset: 0,
    })
    expect(placement.width).toBe(300 - 2 * DROPDOWN_MARGIN)
    expect(placement.left).toBe(DROPDOWN_MARGIN)
  })
})
