import { parseCron, type Cron } from '@dltech/atlas-schedule'

const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_MONTH = 31
const DAYS_PER_WEEK = 7
const MONTHS_PER_YEAR = 12

export enum ESchedulePreset {
  Daily = 'daily',
  Weekdays = 'weekdays',
  Weekly = 'weekly',
  Monthly = 'monthly',
  EveryMinutes = 'every-minutes',
  EveryHours = 'every-hours',
  Custom = 'custom',
}

export const SCHEDULE_PRESET_ORDER: readonly ESchedulePreset[] = [
  ESchedulePreset.Daily,
  ESchedulePreset.Weekdays,
  ESchedulePreset.Weekly,
  ESchedulePreset.Monthly,
  ESchedulePreset.EveryMinutes,
  ESchedulePreset.EveryHours,
  ESchedulePreset.Custom,
]

export const SCHEDULE_PRESET_LABELS: Record<ESchedulePreset, string> = {
  [ESchedulePreset.Daily]: 'Every day',
  [ESchedulePreset.Weekdays]: 'Every weekday',
  [ESchedulePreset.Weekly]: 'Every week',
  [ESchedulePreset.Monthly]: 'Every month',
  [ESchedulePreset.EveryMinutes]: 'Every few minutes',
  [ESchedulePreset.EveryHours]: 'Every few hours',
  [ESchedulePreset.Custom]: 'Custom expression',
}

export const WEEKDAY_NAMES: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

export const MINUTE_INTERVALS: readonly number[] = [5, 10, 15, 20, 30]
export const HOUR_INTERVALS: readonly number[] = [1, 2, 3, 4, 6, 8, 12]

const TIME_PRESETS: ReadonlySet<ESchedulePreset> = new Set([
  ESchedulePreset.Daily,
  ESchedulePreset.Weekdays,
  ESchedulePreset.Weekly,
  ESchedulePreset.Monthly,
])

export const takesTimeOfDay = (preset: ESchedulePreset): boolean => TIME_PRESETS.has(preset)

export interface ScheduleFields {
  preset: ESchedulePreset
  hour: number
  minute: number
  weekday: number
  dayOfMonth: number
  intervalMinutes: number
  intervalHours: number
  custom: string
}

export const DEFAULT_SCHEDULE_FIELDS: ScheduleFields = {
  preset: ESchedulePreset.Weekdays,
  hour: 7,
  minute: 0,
  weekday: 1,
  dayOfMonth: 1,
  intervalMinutes: 10,
  intervalHours: 3,
  custom: '',
}

const pad = (value: number): string => String(value).padStart(2, '0')

export const cronOfFields = (fields: ScheduleFields): string => {
  switch (fields.preset) {
    case ESchedulePreset.Daily:
      return `${fields.minute} ${fields.hour} * * *`
    case ESchedulePreset.Weekdays:
      return `${fields.minute} ${fields.hour} * * 1-5`
    case ESchedulePreset.Weekly:
      return `${fields.minute} ${fields.hour} * * ${fields.weekday}`
    case ESchedulePreset.Monthly:
      return `${fields.minute} ${fields.hour} ${fields.dayOfMonth} * *`
    case ESchedulePreset.EveryMinutes:
      return `*/${fields.intervalMinutes} * * * *`
    case ESchedulePreset.EveryHours:
      return `0 */${fields.intervalHours} * * *`
    case ESchedulePreset.Custom:
      return fields.custom.trim()
  }
}

export const timeOfFields = (fields: ScheduleFields): string =>
  `${pad(fields.hour)}:${pad(fields.minute)}`

export const fieldsWithTime = (fields: ScheduleFields, time: string): ScheduleFields => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (match === null) return fields
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > HOURS_PER_DAY - 1 || minute > MINUTES_PER_HOUR - 1) return fields
  return { ...fields, hour, minute }
}

export const fieldsWithPreset = (
  fields: ScheduleFields,
  preset: ESchedulePreset,
): ScheduleFields => (preset === fields.preset ? fields : { ...fields, preset })

const covers = (values: readonly number[], size: number): boolean => values.length === size

const uniformGapOf = (values: readonly number[], size: number): number | null => {
  const sorted = [...values].sort((left, right) => left - right)
  const first = sorted[0]
  const last = sorted.at(-1)
  const second = sorted[1]
  if (sorted.length < 2 || first === undefined || last === undefined || second === undefined) {
    return null
  }
  const gap = second - first
  if (gap <= 0 || first + size - last !== gap) return null
  const even = sorted.every(
    (value, index) => index === 0 || value - (sorted[index - 1] ?? 0) === gap,
  )
  return even ? gap : null
}

const isWeekdays = (days: readonly number[]): boolean =>
  days.length === 5 && days.every((day, index) => day === index + 1)

const intervalFieldsOf = (cron: Cron): ScheduleFields | null => {
  if (!covers(cron.months, MONTHS_PER_YEAR)) return null
  if (!covers(cron.daysOfMonth, DAYS_PER_MONTH)) return null
  if (!covers(cron.daysOfWeek, DAYS_PER_WEEK)) return null
  if (covers(cron.hours, HOURS_PER_DAY)) {
    const intervalMinutes = uniformGapOf(cron.minutes, MINUTES_PER_HOUR)
    return intervalMinutes === null
      ? null
      : { ...DEFAULT_SCHEDULE_FIELDS, preset: ESchedulePreset.EveryMinutes, intervalMinutes }
  }
  if (cron.minutes.length !== 1) return null
  const intervalHours = uniformGapOf(cron.hours, HOURS_PER_DAY)
  return intervalHours === null
    ? null
    : { ...DEFAULT_SCHEDULE_FIELDS, preset: ESchedulePreset.EveryHours, intervalHours }
}

const clockFieldsOf = (cron: Cron): ScheduleFields | null => {
  const minute = cron.minutes[0]
  const hour = cron.hours[0]
  if (cron.minutes.length !== 1 || cron.hours.length !== 1) return null
  if (minute === undefined || hour === undefined) return null
  if (!covers(cron.months, MONTHS_PER_YEAR)) return null
  const clock = { ...DEFAULT_SCHEDULE_FIELDS, hour, minute }
  if (!covers(cron.daysOfMonth, DAYS_PER_MONTH)) {
    const dayOfMonth = cron.daysOfMonth[0]
    if (!covers(cron.daysOfWeek, DAYS_PER_WEEK) || cron.daysOfMonth.length !== 1) return null
    if (dayOfMonth === undefined) return null
    return { ...clock, preset: ESchedulePreset.Monthly, dayOfMonth }
  }
  if (covers(cron.daysOfWeek, DAYS_PER_WEEK)) return { ...clock, preset: ESchedulePreset.Daily }
  if (isWeekdays(cron.daysOfWeek)) return { ...clock, preset: ESchedulePreset.Weekdays }
  const weekday = cron.daysOfWeek[0]
  if (cron.daysOfWeek.length !== 1 || weekday === undefined) return null
  return { ...clock, preset: ESchedulePreset.Weekly, weekday }
}

export const fieldsOfCron = (expression: string): ScheduleFields => {
  const parsed = parseCron(expression)
  const custom: ScheduleFields = {
    ...DEFAULT_SCHEDULE_FIELDS,
    preset: ESchedulePreset.Custom,
    custom: expression,
  }
  if (!parsed.ok) return custom
  return intervalFieldsOf(parsed.cron) ?? clockFieldsOf(parsed.cron) ?? custom
}

export const presetItemsOf = (): { value: ESchedulePreset; label: string }[] =>
  SCHEDULE_PRESET_ORDER.map((preset) => ({ value: preset, label: SCHEDULE_PRESET_LABELS[preset] }))
