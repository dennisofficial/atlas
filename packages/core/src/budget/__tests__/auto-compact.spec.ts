import { describe, expect, it } from 'bun:test'

import { autoCompactAfterTurn, EAutoCompact } from '../auto-compact'

const WINDOW = 200_000

describe('autoCompactAfterTurn', () => {
  it('holds while the window has room', () => {
    expect(autoCompactAfterTurn({ used: 100_000, window: WINDOW, atPercent: 90 })).toBe(
      EAutoCompact.Hold,
    )
  })

  it('compacts once the turn ends at or past the threshold', () => {
    expect(autoCompactAfterTurn({ used: 180_000, window: WINDOW, atPercent: 90 })).toBe(
      EAutoCompact.AtTurnEnd,
    )
  })

  it('holds at any pressure when the operator turned the threshold off', () => {
    expect(autoCompactAfterTurn({ used: 199_999, window: WINDOW, atPercent: 0 })).toBe(
      EAutoCompact.Hold,
    )
  })

  it('holds rather than dividing by a window it does not know', () => {
    expect(autoCompactAfterTurn({ used: 10, window: 0, atPercent: 90 })).toBe(EAutoCompact.Hold)
  })

  it('honours a threshold the operator moved', () => {
    expect(autoCompactAfterTurn({ used: 120_000, window: WINDOW, atPercent: 50 })).toBe(
      EAutoCompact.AtTurnEnd,
    )
  })
})
