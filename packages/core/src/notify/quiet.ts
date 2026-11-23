import type { SettingScalar } from '../settings/cloud/setting-codec'
import { CLOUD_SETTING_REGISTRY } from '../settings/cloud/settings-registry'
import { type ENotifyMoment, notifySettingKeyOf } from './moment'

const NOTIFY_PREFIX = 'web.notifications'
const PUSH_CHANNEL = 'push'
const TIMEZONE_KEY = `${NOTIFY_PREFIX}.timezone`
const QUIET_HOURS_KEY = `${NOTIFY_PREFIX}.quietHours`
const QUIET_FROM_KEY = `${NOTIFY_PREFIX}.quietFrom`
const QUIET_TO_KEY = `${NOTIFY_PREFIX}.quietTo`

export const notifyEventSettingKey = (moment: ENotifyMoment): string =>
  `${NOTIFY_PREFIX}.event.${notifySettingKeyOf(moment)}.${PUSH_CHANNEL}`

const settingOf = (args: { values: ReadonlyMap<string, unknown>; key: string }): SettingScalar => {
  const entry = CLOUD_SETTING_REGISTRY.get(args.key)
  if (entry === undefined) throw new Error(`setting ${args.key} is not in the registry`)
  const parsed = entry.schema.safeParse(args.values.get(args.key))
  return parsed.success ? parsed.data : entry.fallback
}

const boolOf = (args: { values: ReadonlyMap<string, unknown>; key: string }): boolean =>
  settingOf(args) === true

const stringOf = (args: { values: ReadonlyMap<string, unknown>; key: string }): string => {
  const value = settingOf(args)
  return typeof value === 'string' ? value : ''
}

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

const minutesOfClock = (clock: string): number | null => {
  const match = CLOCK_PATTERN.exec(clock)
  if (match === null) return null
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
}

const minutesAt = (args: { at: Date; timeZone: string }): number | null => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: args.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(args.at)
    const hour = parts.find((part) => part.type === 'hour')?.value
    const minute = parts.find((part) => part.type === 'minute')?.value
    if (hour === undefined || minute === undefined) return null
    return Number(hour) * 60 + Number(minute)
  } catch {
    return null
  }
}

export type QuietHoursInput = {
  enabled: boolean
  from: string
  to: string
  timeZone: string
  now: string
}

export const inQuietHours = (args: QuietHoursInput): boolean => {
  if (!args.enabled) return false
  if (args.timeZone.trim() === '') return false
  const from = minutesOfClock(args.from)
  const to = minutesOfClock(args.to)
  if (from === null || to === null || from === to) return false
  const at = new Date(args.now)
  if (Number.isNaN(at.getTime())) return false
  const minutes = minutesAt({ at, timeZone: args.timeZone })
  if (minutes === null) return false
  if (from < to) return minutes >= from && minutes < to
  return minutes >= from || minutes < to
}

export type NotifySettings = {
  enabled: (moment: ENotifyMoment) => boolean
  quiet: (args: { now: string }) => boolean
}

export const notifySettingsOf = (args: {
  values: ReadonlyMap<string, unknown>
}): NotifySettings => ({
  enabled: (moment) => boolOf({ values: args.values, key: notifyEventSettingKey(moment) }),
  quiet: ({ now }) =>
    inQuietHours({
      enabled: boolOf({ values: args.values, key: QUIET_HOURS_KEY }),
      from: stringOf({ values: args.values, key: QUIET_FROM_KEY }),
      to: stringOf({ values: args.values, key: QUIET_TO_KEY }),
      timeZone: stringOf({ values: args.values, key: TIMEZONE_KEY }),
      now,
    }),
})
