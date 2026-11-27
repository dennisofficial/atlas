import { describe, expect, it } from 'bun:test'

import { routineSettingsChanges, routineSettingsFrom } from '../routine-settings'

describe('routineSettingsFrom', () => {
  it('reads the stored zone', () => {
    expect(routineSettingsFrom(new Map([['web.routine.timezone', 'Asia/Tokyo']]))).toEqual({
      timezone: 'Asia/Tokyo',
    })
  })

  it('reads an empty zone when nothing is stored', () => {
    expect(routineSettingsFrom(new Map())).toEqual({ timezone: '' })
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
