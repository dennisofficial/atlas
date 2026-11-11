import {
  type Cron,
  CronNeverFiresError,
  parseCron,
  upcomingOccurrences,
} from '@dltech/atlas-schedule'

const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_MONTH = 31
const DAYS_PER_WEEK = 7
const MONTHS_PER_YEAR = 12
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const cronOf = (expression: string): Cron | null => {
  const parsed = parseCron(expression)
  return parsed.ok ? parsed.cron : null
}

export const isKnownTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

const covers = (values: readonly number[], size: number): boolean => values.length === size

const pad = (value: number): string => String(value).padStart(2, '0')

const ordinalOf = (day: number): string => {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`
  const last = day % 10
  if (last === 1) return `${day}st`
  if (last === 2) return `${day}nd`
  if (last === 3) return `${day}rd`
  return `${day}th`
}

const isWeekdays = (days: readonly number[]): boolean =>
  days.length === 5 && days.every((day, index) => day === index + 1)

const uniformGapOf = ({
  values,
  size,
}: {
  values: readonly number[]
  size: number
}): number | null => {
  const sorted = [...values].sort((left, right) => left - right)
  const first = sorted[0]
  const last = sorted.at(-1)
  if (sorted.length < 2 || first === undefined || last === undefined) return null
  const gap = (sorted[1] ?? 0) - first
  if (first + size - last !== gap) return null
  const even = sorted.every(
    (minute, index) => index === 0 || minute - (sorted[index - 1] ?? 0) === gap,
  )
  return even ? gap : null
}

const minuteCadenceOf = (cron: Cron): string | null => {
  if (!covers(cron.hours, HOURS_PER_DAY)) return null
  if (cron.minutes.length === MINUTES_PER_HOUR) return 'Every minute'
  if (cron.minutes.length === 1) return `Every hour at :${pad(cron.minutes[0] ?? 0)}`
  const gap = uniformGapOf({ values: cron.minutes, size: MINUTES_PER_HOUR })
  return gap === null ? null : `Every ${gap} minutes`
}

const hourCadenceOf = (cron: Cron): string | null => {
  if (cron.minutes.length !== 1) return null
  const gap = uniformGapOf({ values: cron.hours, size: HOURS_PER_DAY })
  if (gap === null) return null
  return gap === 1 ? 'Every hour' : `Every ${gap} hours`
}

const weekdaysOf = ({ days, at }: { days: readonly number[]; at: string }): string | null => {
  if (isWeekdays(days)) return `Every weekday at ${at}`
  if (days.length === 1) return `Every ${WEEKDAYS[days[0] ?? 0]} at ${at}`
  return null
}

const summaryOfCron = (cron: Cron): string => {
  const minute = cron.minutes[0] ?? 0
  if (!covers(cron.months, MONTHS_PER_YEAR)) return cron.expression
  const cadence = minuteCadenceOf(cron) ?? hourCadenceOf(cron)
  if (cadence !== null) return cadence
  if (cron.minutes.length !== 1 || cron.hours.length !== 1) return cron.expression
  const at = `${pad(cron.hours[0] ?? 0)}:${pad(minute)}`
  const everyDayOfMonth = covers(cron.daysOfMonth, DAYS_PER_MONTH)
  const everyDayOfWeek = covers(cron.daysOfWeek, DAYS_PER_WEEK)
  if (everyDayOfMonth && everyDayOfWeek) return `Every day at ${at}`
  if (everyDayOfMonth) return weekdaysOf({ days: cron.daysOfWeek, at }) ?? cron.expression
  if (everyDayOfWeek && cron.daysOfMonth.length === 1) {
    return `Monthly on the ${ordinalOf(cron.daysOfMonth[0] ?? 1)} at ${at}`
  }
  return cron.expression
}

export const scheduleSummaryOf = (expression: string): string => {
  const cron = cronOf(expression)
  return cron === null ? expression : summaryOfCron(cron)
}

export const nextOccurrencesOf = (args: {
  cron: string
  timeZone: string
  from: number
  count: number
}): readonly string[] => {
  const cron = cronOf(args.cron)
  if (cron === null || !isKnownTimezone(args.timeZone)) return []
  try {
    return upcomingOccurrences({
      cron,
      after: new Date(args.from),
      timezone: args.timeZone,
      count: args.count,
    }).map((occurrence) => occurrence.toISOString())
  } catch (error) {
    if (error instanceof CronNeverFiresError) return []
    throw error
  }
}
