import { NOTIFY_CHANNEL_IDS, NOTIFY_EVENT_IDS } from '@dltech/atlas-wire/web'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import {
  EDensity,
  ETheme,
  ENotifyChannel,
  type AppearanceSettings,
  type NotificationSettings,
  type NotifyMatrix,
} from '../../fixtures/settings-interface'
import { diffChanges, settingBool, settingString, settingValue } from './settings-values'

const APPEARANCE_PREFIX = 'web.appearance.'
const NOTIFY_PREFIX = 'web.notifications.'

export const EXPERIMENT_KEYS: Record<string, string> = {
  'parallel-tool-calls': 'web.experimental.parallelToolCalls',
  'speculative-classifier': 'web.experimental.speculativeClassifier',
  'auto-compact': 'web.experimental.autoCompact',
  'born-in-cloud': 'web.experimental.bornInCloud',
  'web-terminal': 'web.experimental.webTerminal',
  'plan-mode-default': 'web.experimental.planModeDefault',
}

const isTheme = (value: string): value is ETheme => Object.values(ETheme).some((t) => t === value)
const isDensity = (value: string): value is EDensity =>
  Object.values(EDensity).some((d) => d === value)

export function experimentEnabled(args: { values: SettingValues; id: string }): boolean {
  const key = EXPERIMENT_KEYS[args.id]
  return key !== undefined && settingBool({ values: args.values, key })
}

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

const eventChannelKey = (args: { event: string; channel: string }) =>
  `${NOTIFY_PREFIX}event.${args.event}.${args.channel}`

export function notificationsFrom(values: SettingValues): NotificationSettings {
  const matrix: NotifyMatrix = {}
  for (const event of NOTIFY_EVENT_IDS) {
    matrix[event] = {
      [ENotifyChannel.InApp]: false,
      [ENotifyChannel.Push]: false,
      [ENotifyChannel.Email]: false,
    }
    for (const channel of NOTIFY_CHANNEL_IDS) {
      const row = matrix[event]
      if (row) row[channel] = settingBool({ values, key: eventChannelKey({ event, channel }) })
    }
  }
  return {
    channels: {
      push: settingBool({ values, key: `${NOTIFY_PREFIX}channel.push` }),
      email: settingBool({ values, key: `${NOTIFY_PREFIX}channel.email` }),
      slack: settingBool({ values, key: `${NOTIFY_PREFIX}channel.slack` }),
    },
    matrix,
    quietHours: settingBool({ values, key: `${NOTIFY_PREFIX}quietHours` }),
    quietFrom: settingString({ values, key: `${NOTIFY_PREFIX}quietFrom` }),
    quietTo: settingString({ values, key: `${NOTIFY_PREFIX}quietTo` }),
  }
}

function notificationsFlat(settings: NotificationSettings): Record<string, string | boolean> {
  const flat: Record<string, string | boolean> = {
    [`${NOTIFY_PREFIX}channel.push`]: settings.channels.push,
    [`${NOTIFY_PREFIX}channel.email`]: settings.channels.email,
    [`${NOTIFY_PREFIX}channel.slack`]: settings.channels.slack,
    [`${NOTIFY_PREFIX}quietHours`]: settings.quietHours,
    [`${NOTIFY_PREFIX}quietFrom`]: settings.quietFrom,
    [`${NOTIFY_PREFIX}quietTo`]: settings.quietTo,
  }
  for (const event of NOTIFY_EVENT_IDS) {
    for (const channel of NOTIFY_CHANNEL_IDS) {
      flat[eventChannelKey({ event, channel })] = settings.matrix[event]?.[channel] ?? false
    }
  }
  return flat
}

export function notificationChanges(args: {
  saved: NotificationSettings
  draft: NotificationSettings
}): SettingChanges {
  return diffChanges({ saved: notificationsFlat(args.saved), draft: notificationsFlat(args.draft) })
}
