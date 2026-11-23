import { describe, expect, it } from 'bun:test'

import { ENotifyMoment } from '../moment'
import { inQuietHours, notifyEventSettingKey, notifySettingsOf } from '../quiet'

const QUIET = { enabled: true, from: '22:00', to: '07:00', timeZone: 'Europe/Berlin' }

describe('inQuietHours', () => {
  it('is quiet after the start of a window that wraps midnight', () => {
    expect(inQuietHours({ ...QUIET, now: '2026-11-23T22:30:00.000Z' })).toBe(true)
  })

  it('is quiet before the end of a window that wraps midnight', () => {
    expect(inQuietHours({ ...QUIET, now: '2026-11-23T23:30:00.000Z' })).toBe(true)
  })

  it('is loud in the middle of the day', () => {
    expect(inQuietHours({ ...QUIET, now: '2026-11-23T12:00:00.000Z' })).toBe(false)
  })

  it('is quiet inside a window that does not wrap midnight', () => {
    expect(
      inQuietHours({ ...QUIET, from: '13:00', to: '15:00', now: '2026-11-23T12:30:00.000Z' }),
    ).toBe(true)
  })

  it('follows the zone through daylight saving time', () => {
    const window = { ...QUIET, from: '14:00', to: '15:00' }
    expect(inQuietHours({ ...window, now: '2026-07-01T12:30:00.000Z' })).toBe(true)
    expect(inQuietHours({ ...window, now: '2026-01-15T12:30:00.000Z' })).toBe(false)
  })

  it('is loud when quiet hours are off', () => {
    expect(inQuietHours({ ...QUIET, enabled: false, now: '2026-11-23T22:30:00.000Z' })).toBe(false)
  })

  it('is loud when the window is empty', () => {
    expect(
      inQuietHours({ ...QUIET, from: '07:00', to: '07:00', now: '2026-11-23T05:30:00.000Z' }),
    ).toBe(false)
  })

  it('is loud without a zone', () => {
    expect(inQuietHours({ ...QUIET, timeZone: '', now: '2026-11-23T22:30:00.000Z' })).toBe(false)
  })

  it('is loud when the zone is not one Intl knows', () => {
    expect(
      inQuietHours({ ...QUIET, timeZone: 'Mars/Olympus', now: '2026-11-23T22:30:00.000Z' }),
    ).toBe(false)
  })
})

describe('notifySettingsOf', () => {
  const values = new Map<string, unknown>()

  it('reads each moment from its push key', () => {
    expect(notifySettingsOf({ values }).enabled(ENotifyMoment.WaitingForYou)).toBe(true)
    expect(notifyEventSettingKey(ENotifyMoment.TurnFailed)).toBe(
      'web.notifications.event.errored.push',
    )
  })

  it('reads a moment the user turned off', () => {
    const settings = notifySettingsOf({
      values: new Map([['web.notifications.event.finished.push', false]]),
    })
    expect(settings.enabled(ENotifyMoment.TurnFinished)).toBe(false)
    expect(settings.enabled(ENotifyMoment.TurnFailed)).toBe(true)
    expect(values.size).toBe(0)
  })

  it('is quiet only when the stored zone says so', () => {
    const stored = new Map<string, unknown>([
      ['web.notifications.quietHours', true],
      ['web.notifications.quietFrom', '22:00'],
      ['web.notifications.quietTo', '07:00'],
      ['web.notifications.timezone', 'Europe/Berlin'],
    ])
    expect(notifySettingsOf({ values: stored }).quiet({ now: '2026-11-23T23:30:00.000Z' })).toBe(
      true,
    )
    expect(notifySettingsOf({ values: stored }).quiet({ now: '2026-11-23T12:00:00.000Z' })).toBe(
      false,
    )
  })
})
