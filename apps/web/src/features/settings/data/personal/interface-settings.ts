export {
  appearanceChanges,
  appearanceFrom,
  type IAppearanceSettings as AppearanceSettings,
} from '@dltech/atlas-client/settings'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import { settingBool, settingString } from './settings-values'
import type {
  NotificationSettings,
  NotifyEventToggles,
  NotifyMomentId,
} from '../../fixtures/settings-interface'
import { diffChanges } from './settings-values'

const NOTIFY_PREFIX = 'web.notifications.'

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
