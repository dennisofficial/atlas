import { z } from 'zod'

import { deviceTimezone } from '@/features/routines/routine-timezones'
import { resolveSetting, type SettingChanges, type SettingValues } from '@/lib/cloud-settings'

export const ROUTINE_TIMEZONE_KEY = 'web.routine.timezone'

export interface RoutineSettings {
  timezone: string
}

export const routineSettingsFrom = (values: SettingValues): RoutineSettings => ({
  timezone: resolveSetting({ values, key: ROUTINE_TIMEZONE_KEY, schema: z.string() }),
})

export const routineSettingsChanges = ({
  saved,
  draft,
}: {
  saved: RoutineSettings
  draft: RoutineSettings
}): SettingChanges =>
  saved.timezone === draft.timezone ? {} : { [ROUTINE_TIMEZONE_KEY]: draft.timezone }

export const routineTimezoneOf = (stored: string): string =>
  stored.trim() === '' ? deviceTimezone() : stored
