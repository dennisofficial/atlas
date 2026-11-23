import { describe, expect, it } from 'bun:test'

import { AUTO_ROTATE_OFF, autoRotateAfterTurn, EAutoRotate } from '../auto-rotate'

const WINDOW = 200_000

describe('autoRotateAfterTurn', () => {
  it('holds when the setting is zero', () => {
    expect(autoRotateAfterTurn({ used: WINDOW, window: WINDOW, atPercent: AUTO_ROTATE_OFF })).toBe(
      EAutoRotate.Hold,
    )
  })

  it('holds under the threshold', () => {
    expect(autoRotateAfterTurn({ used: 160_000, window: WINDOW, atPercent: 85 })).toBe(
      EAutoRotate.Hold,
    )
  })

  it('rotates at the threshold', () => {
    expect(autoRotateAfterTurn({ used: 170_000, window: WINDOW, atPercent: 85 })).toBe(
      EAutoRotate.AtTurnEnd,
    )
  })

  it('holds on a null reading', () => {
    expect(autoRotateAfterTurn({ used: null, window: WINDOW, atPercent: 85 })).toBe(
      EAutoRotate.Hold,
    )
    expect(autoRotateAfterTurn({ used: 170_000, window: null, atPercent: 85 })).toBe(
      EAutoRotate.Hold,
    )
  })

  it('holds on a zero window', () => {
    expect(autoRotateAfterTurn({ used: 10, window: 0, atPercent: 85 })).toBe(EAutoRotate.Hold)
  })
})
