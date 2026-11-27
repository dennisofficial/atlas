import { deviceTimezone } from '@/features/routines/routine-timezones'

export {
  ROUTINE_TIMEZONE_KEY,
  routineSettingsChanges,
  routineSettingsFrom,
  type IRoutineSettings as RoutineSettings,
} from '@dltech/atlas-client/settings'

export const routineTimezoneOf = (stored: string): string =>
  stored.trim() === '' ? deviceTimezone() : stored
