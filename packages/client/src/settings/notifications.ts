import { ENotifyDeviceKind } from '@dltech/atlas-core'
import type { SettingScalar } from '@dltech/atlas-wire/web'

import { diffChanges, settingBool, settingString } from './setting-values'
import { deviceTimezone } from './timezones'

const NOTIFY_PREFIX = 'web.notifications.'

export const NOTIFY_TIMEZONE_KEY = `${NOTIFY_PREFIX}timezone`
export const NOTIFY_QUIET_HOURS_KEY = `${NOTIFY_PREFIX}quietHours`
export const NOTIFY_QUIET_FROM_KEY = `${NOTIFY_PREFIX}quietFrom`
export const NOTIFY_QUIET_TO_KEY = `${NOTIFY_PREFIX}quietTo`

export type NotifyMomentId = 'finished' | 'errored' | 'approval'

export type NotifyMomentRow = { id: NotifyMomentId; title: string; description: string }

export const NOTIFY_MOMENTS: readonly NotifyMomentRow[] = [
  { id: 'finished', title: 'Finished', description: 'A turn ended and the agent is done.' },
  { id: 'errored', title: 'Failed', description: 'A turn stopped on a failure.' },
  {
    id: 'approval',
    title: 'Waiting for you',
    description: 'A tool call or a credential needs your answer.',
  },
]

export type NotifyEventToggles = Record<NotifyMomentId, boolean>

export type NotificationSettings = {
  events: NotifyEventToggles
  quietHours: boolean
  quietFrom: string
  quietTo: string
  timezone: string
}

export const QUIET_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, '0')}:00`
  return { value, label: value }
})

export const notifyEventKey = (moment: NotifyMomentId): string =>
  `${NOTIFY_PREFIX}event.${moment}.push`

export const notificationsFrom = (
  values: ReadonlyMap<string, SettingScalar>,
): NotificationSettings => ({
  events: {
    finished: settingBool({ values, key: notifyEventKey('finished') }),
    errored: settingBool({ values, key: notifyEventKey('errored') }),
    approval: settingBool({ values, key: notifyEventKey('approval') }),
  },
  quietHours: settingBool({ values, key: NOTIFY_QUIET_HOURS_KEY }),
  quietFrom: settingString({ values, key: NOTIFY_QUIET_FROM_KEY }),
  quietTo: settingString({ values, key: NOTIFY_QUIET_TO_KEY }),
  timezone: settingString({ values, key: NOTIFY_TIMEZONE_KEY }),
})

const notificationsFlat = (settings: NotificationSettings): Record<string, SettingScalar> => ({
  [notifyEventKey('finished')]: settings.events.finished,
  [notifyEventKey('errored')]: settings.events.errored,
  [notifyEventKey('approval')]: settings.events.approval,
  [NOTIFY_QUIET_HOURS_KEY]: settings.quietHours,
  [NOTIFY_QUIET_FROM_KEY]: settings.quietFrom,
  [NOTIFY_QUIET_TO_KEY]: settings.quietTo,
  [NOTIFY_TIMEZONE_KEY]: settings.timezone,
})

export const notificationChanges = (args: {
  saved: NotificationSettings
  draft: NotificationSettings
}): Record<string, SettingScalar | null> =>
  diffChanges({ saved: notificationsFlat(args.saved), draft: notificationsFlat(args.draft) })

export const withDeviceZone = (settings: NotificationSettings): NotificationSettings =>
  settings.timezone === '' ? { ...settings, timezone: deviceTimezone() } : settings

export const NOTIFY_DEVICE_KIND_LABELS: Record<ENotifyDeviceKind, string> = {
  [ENotifyDeviceKind.WebPush]: 'Web',
  [ENotifyDeviceKind.Expo]: 'iPhone',
  [ENotifyDeviceKind.ApnsMac]: 'Mac',
}

export const notifyDeviceDetailOf = (args: { kind: ENotifyDeviceKind; enabled: boolean }): string =>
  `${NOTIFY_DEVICE_KIND_LABELS[args.kind] ?? args.kind}, ${args.enabled ? 'On' : 'Off'}`

export const withDeviceEnabled = (args: {
  overrides: Readonly<Record<string, boolean>>
  deviceId: string
  enabled: boolean
}): Record<string, boolean> => ({ ...args.overrides, [args.deviceId]: args.enabled })
