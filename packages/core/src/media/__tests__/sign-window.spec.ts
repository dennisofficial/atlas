import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { SIGN_VALIDITY_MS, SIGN_WINDOW_MS, validUntilOf, windowStartOf } from '../sign-window'

const DAY_MS = 24 * 60 * 60 * 1000
const instant = fc.integer({ min: 0, max: 4_102_444_800_000 })

describe('the shared signing window', () => {
  it('leaves every url more than a day and at most seven days to live', () => {
    fc.assert(
      fc.property(instant, (now) => {
        const left = validUntilOf(windowStartOf(now)) - now
        expect(left).toBeGreaterThan(DAY_MS)
        expect(left).toBeLessThanOrEqual(SIGN_VALIDITY_MS)
      }),
    )
  })

  it('starts at or before the instant and less than a window earlier', () => {
    fc.assert(
      fc.property(instant, (now) => {
        const start = windowStartOf(now)
        expect(start).toBeLessThanOrEqual(now)
        expect(now - start).toBeLessThan(SIGN_WINDOW_MS)
        expect(start % SIGN_WINDOW_MS).toBe(0)
      }),
    )
  })

  it('gives one window to every instant inside it', () => {
    fc.assert(
      fc.property(instant, fc.integer({ min: 0, max: SIGN_WINDOW_MS - 1 }), (base, offset) => {
        const start = windowStartOf(base)
        expect(windowStartOf(start + offset)).toBe(start)
      }),
    )
  })

  it('holds at the boundaries', () => {
    expect(windowStartOf(0)).toBe(0)
    expect(windowStartOf(SIGN_WINDOW_MS - 1)).toBe(0)
    expect(windowStartOf(SIGN_WINDOW_MS)).toBe(SIGN_WINDOW_MS)
    expect(validUntilOf(windowStartOf(0)) - 0).toBe(SIGN_VALIDITY_MS)
    expect(validUntilOf(windowStartOf(SIGN_WINDOW_MS - 1)) - (SIGN_WINDOW_MS - 1)).toBe(DAY_MS + 1)
  })
})
