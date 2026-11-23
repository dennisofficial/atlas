import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import {
  EDensity,
  ETheme,
  type AppearanceSettings,
  type NotificationSettings,
  type NotifyEventToggles,
  type NotifyMomentId,
} from '../../fixtures/settings-interface'
import { diffChanges, settingBool, settingString, settingValue } from './settings-values'

const APPEARANCE_PREFIX = 'web.appearance.'
const NOTIFY_PREFIX = 'web.notifications.'

const isTheme = (value: string): value is ETheme => Object.values(ETheme).some((t) => t === value)
const isDensity = (value: string): value is EDensity =>
  Object.values(EDensity).some((d) => d === value)

export function appearanceFrom(values: SettingValues): AppearanceSettings {
  const theme = settingString({ values, key: `${APPEARANCE_PREFIX}theme` })
  const density = settingString({ values, key: `${APPEARANCE_PREFIX}density` })
  const size = settingValue({ values, key: `${APPEARANCE_PREFIX}codeFontSize` })
  return {
    theme: isTheme(theme) ? theme : ETheme.Dark,
    density: isDensity(density) ? density : EDensity.Comfortable,
    codeFontSize: size === 12 || size === 14 ? size : 13,
    showDiffStat: settingBool({ values, key: `${APPEARANCE_PREFIX}showDiffStat` }),
    reduceMotion: settingBool({ values, key: `${APPEARANCE_PREFIX}reduceMotion` }),
  }
}

const appearanceFlat = (settings: AppearanceSettings) => ({
  [`${APPEARANCE_PREFIX}theme`]: settings.theme,
  [`${APPEARANCE_PREFIX}density`]: settings.density,
  [`${APPEARANCE_PREFIX}codeFontSize`]: settings.codeFontSize,
  [`${APPEARANCE_PREFIX}showDiffStat`]: settings.showDiffStat,
  [`${APPEARANCE_PREFIX}reduceMotion`]: settings.reduceMotion,
})

export function appearanceChanges(args: {
  saved: AppearanceSettings
  draft: AppearanceSettings
}): SettingChanges {
  return diffChanges({ saved: appearanceFlat(args.saved), draft: appearanceFlat(args.draft) })
}

export const notifyEventKey = (moment: NotifyMomentId): string =>
  `${NOTIFY_PREFIX}event.${moment}.push`

const eventsOf = (values: SettingValues): NotifyEventToggles => ({
  finished: settingBool({ values, key: notifyEventKey('finished') }),
  errored: settingBool({ values, key: notifyEventKey('errored') }),
  approval: settingBool({ values, key: notifyEventKey('approval') }),
})

export function notificationsFrom(values: SettingValues): NotificationSettings {
  return {
    events: eventsOf(values),
    quietHours: settingBool({ values, key: `${NOTIFY_PREFIX}quietHours` }),
    quietFrom: settingString({ values, key: `${NOTIFY_PREFIX}quietFrom` }),
    quietTo: settingString({ values, key: `${NOTIFY_PREFIX}quietTo` }),
    timezone: settingString({ values, key: `${NOTIFY_PREFIX}timezone` }),
  }
}

function notificationsFlat(settings: NotificationSettings): Record<string, string | boolean> {
  return {
    [notifyEventKey('finished')]: settings.events.finished,
    [notifyEventKey('errored')]: settings.events.errored,
    [notifyEventKey('approval')]: settings.events.approval,
    [`${NOTIFY_PREFIX}quietHours`]: settings.quietHours,
    [`${NOTIFY_PREFIX}quietFrom`]: settings.quietFrom,
    [`${NOTIFY_PREFIX}quietTo`]: settings.quietTo,
    [`${NOTIFY_PREFIX}timezone`]: settings.timezone,
  }
}

export function notificationChanges(args: {
  saved: NotificationSettings
  draft: NotificationSettings
}): SettingChanges {
  return diffChanges({ saved: notificationsFlat(args.saved), draft: notificationsFlat(args.draft) })
}
