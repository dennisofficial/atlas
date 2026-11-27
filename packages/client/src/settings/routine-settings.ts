import { resolveCloudSetting } from '@dltech/atlas-wire/web'
import { z } from 'zod'

import type { ISettingChanges, ISettingValues } from './setting-values'

export const ROUTINE_TIMEZONE_KEY = 'web.routine.timezone'

export type IRoutineSettings = { timezone: string }

export const routineSettingsFrom = (values: ISettingValues): IRoutineSettings => ({
  timezone: resolveCloudSetting({ values, key: ROUTINE_TIMEZONE_KEY, schema: z.string() }),
})

export const routineSettingsChanges = (args: {
  saved: IRoutineSettings
  draft: IRoutineSettings
}): ISettingChanges =>
  args.saved.timezone === args.draft.timezone ? {} : { [ROUTINE_TIMEZONE_KEY]: args.draft.timezone }
