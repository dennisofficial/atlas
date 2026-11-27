import { describe, expect, it } from 'bun:test'

import { routineTimezoneOf } from '../routine-settings'

describe('routineTimezoneOf', () => {
  it('uses the stored zone', () => {
    expect(routineTimezoneOf('Asia/Tokyo')).toBe('Asia/Tokyo')
  })

  it('falls back to this device when nothing is stored', () => {
    const zone = routineTimezoneOf('')
    expect(zone.length).toBeGreaterThan(0)
    expect(zone).not.toBe('')
  })
})
