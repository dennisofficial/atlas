import { ENotifyDeviceKind } from '@dltech/atlas-core'
import type { SettingScalar } from '@dltech/atlas-wire/web'
import { describe, expect, it } from 'bun:test'

import {
  NOTIFY_DEVICE_KIND_LABELS,
  NOTIFY_MOMENTS,
  NOTIFY_QUIET_FROM_KEY,
  NOTIFY_QUIET_HOURS_KEY,
  NOTIFY_QUIET_TO_KEY,
  NOTIFY_TIMEZONE_KEY,
  notificationChanges,
  notificationsFrom,
  notifyDeviceDetailOf,
  notifyEventKey,
  QUIET_HOUR_OPTIONS,
  withDeviceEnabled,
  withDeviceZone,
} from '../notifications'
import { deviceTimezone } from '../timezones'

describe('notification settings', () => {
  it('reads every default from the registry', () => {
    const saved = notificationsFrom(new Map())
    expect(saved).toEqual({
      events: { finished: true, errored: true, approval: true },
      quietHours: true,
      quietFrom: '22:00',
      quietTo: '07:00',
      timezone: '',
    })
  })

  it('reads and diffs the three notification moments', () => {
    const saved = notificationsFrom(
      new Map<string, SettingScalar>([
        [notifyEventKey('finished'), false],
        [NOTIFY_TIMEZONE_KEY, 'Europe/Berlin'],
      ]),
    )
    expect(saved.events).toEqual({ finished: false, errored: true, approval: true })
    expect(saved.timezone).toBe('Europe/Berlin')
    const draft = { ...saved, quietFrom: '23:00' }
    expect(notificationChanges({ saved, draft })).toEqual({
      [NOTIFY_QUIET_FROM_KEY]: '23:00',
    })
  })

  it('writes a moment to its push key and keeps the zone', () => {
    const saved = notificationsFrom(new Map())
    const draft = { ...saved, events: { ...saved.events, approval: false }, timezone: 'UTC' }
    expect(notificationChanges({ saved, draft })).toEqual({
      [notifyEventKey('approval')]: false,
      [NOTIFY_TIMEZONE_KEY]: 'UTC',
    })
  })

  it('reports no change for an identical draft', () => {
    const saved = notificationsFrom(new Map())
    expect(notificationChanges({ saved, draft: { ...saved } })).toEqual({})
  })

  it('names the moments in order', () => {
    expect(NOTIFY_MOMENTS.map((moment) => moment.title)).toEqual([
      'Finished',
      'Failed',
      'Waiting for you',
    ])
    for (const moment of NOTIFY_MOMENTS) {
      expect(notifyEventKey(moment.id)).toBe(`web.notifications.event.${moment.id}.push`)
    }
  })

  it('offers every quiet hour', () => {
    expect(QUIET_HOUR_OPTIONS).toHaveLength(24)
    expect(QUIET_HOUR_OPTIONS[0]).toEqual({ value: '00:00', label: '00:00' })
    expect(QUIET_HOUR_OPTIONS[23]).toEqual({ value: '23:00', label: '23:00' })
  })

  it('defaults the zone to the device zone only when none is stored', () => {
    const saved = notificationsFrom(new Map())
    expect(withDeviceZone(saved).timezone).toBe(deviceTimezone())
    const stored = { ...saved, timezone: 'Asia/Tokyo' }
    expect(withDeviceZone(stored)).toBe(stored)
  })

  it('ignores a quiet-hour value the registry rejects', () => {
    const saved = notificationsFrom(
      new Map<string, SettingScalar>([
        [NOTIFY_QUIET_FROM_KEY, '25:00'],
        [NOTIFY_QUIET_HOURS_KEY, 'yes'],
      ]),
    )
    expect(saved.quietFrom).toBe('22:00')
    expect(saved.quietHours).toBe(true)
  })

  it('writes the quiet window to its keys', () => {
    const saved = notificationsFrom(new Map())
    const draft = { ...saved, quietHours: false, quietTo: '08:00' }
    expect(notificationChanges({ saved, draft })).toEqual({
      [NOTIFY_QUIET_HOURS_KEY]: false,
      [NOTIFY_QUIET_TO_KEY]: '08:00',
    })
  })
})

describe('notification devices', () => {
  it('labels each device kind', () => {
    expect(NOTIFY_DEVICE_KIND_LABELS).toEqual({
      [ENotifyDeviceKind.WebPush]: 'Web',
      [ENotifyDeviceKind.Expo]: 'iPhone',
      [ENotifyDeviceKind.ApnsMac]: 'Mac',
    })
  })

  it('describes a device with its state', () => {
    expect(notifyDeviceDetailOf({ kind: ENotifyDeviceKind.Expo, enabled: true })).toBe(
      'iPhone · On',
    )
    expect(notifyDeviceDetailOf({ kind: ENotifyDeviceKind.ApnsMac, enabled: false })).toBe(
      'Mac · Off',
    )
  })

  it('records a device switch without touching the others', () => {
    const overrides = withDeviceEnabled({
      overrides: { 'device-1': false },
      deviceId: 'device-2',
      enabled: true,
    })
    expect(overrides).toEqual({ 'device-1': false, 'device-2': true })
  })
})
