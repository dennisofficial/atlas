import { describe, expect, it } from 'bun:test'

import { routineSettingsChanges, routineTimezoneOf } from '../routine-settings'

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

describe('routineSettingsChanges', () => {
  it('writes nothing when the zone did not change', () => {
    expect(
      routineSettingsChanges({ saved: { timezone: 'UTC' }, draft: { timezone: 'UTC' } }),
    ).toEqual({})
  })

  it('writes the new zone', () => {
    expect(
      routineSettingsChanges({ saved: { timezone: 'UTC' }, draft: { timezone: 'Europe/Berlin' } }),
    ).toEqual({ 'web.routine.timezone': 'Europe/Berlin' })
  })
})
