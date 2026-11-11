import type { Cron } from './cron'
import { parseCron } from './parse'
import { type Clock, extractClock } from './text-time'

export type ParsedScheduleText = { ok: true; cron: Cron } | { ok: false; reason: string }

type ExpressionRead = { ok: true; expression: string } | { ok: false; reason: string }

const CRON_FIELD_COUNT = 5
const MAX_MINUTE_STEP = 59
const MAX_HOUR_STEP = 23
const FIRST_DAY_OF_MONTH = 1
const LAST_DAY_OF_MONTH = 31
const STAR = '*'
const WEEKDAYS = '1-5'
const SPACES = /\s+/gu
const TRAILING_PUNCTUATION = /[.,!?;]+$/u
const CRON_FIELD = /^[0-9a-z*,\-/]+$/i
const CRON_MINUTE_FIELD = /^[0-9*]/

const EMPTY_REASON = 'Say when it should run, for example "every weekday at 7am".'
const UNREADABLE_REASON =
  'Type a schedule like "every weekday at 7am", "every 15 minutes" or "on the 1st of the month".'
const MINUTE_STEP_REASON = 'Minutes repeat at most every 59 minutes; use hours for anything longer.'
const HOUR_STEP_REASON = 'Hours repeat at most every 23 hours; use a daily schedule instead.'
const DAY_REASON = 'Days of the month run from 1 to 31.'
const CRON_REASON = 'That looks like a cron expression but it does not parse:'

const MINUTE_INTERVAL = /^every (\d{1,3}) ?(?:minutes?|mins?|m)$/
const HOUR_INTERVAL = /^every (\d{1,3}) ?(?:hours?|hrs?|h)$/
const EVERY_MINUTE = /^every minute$/
const HOURLY = /^(?:hourly|every hour)$/
const HOURLY_AT_MINUTE = /^every hour at :(\d{1,2})$/
const DAILY = /^(?:daily|every day|everyday|each day)$/
const WEEKDAY = /^(?:every weekday|weekdays|on weekdays|weekday)$/
const MONTHLY = /^(?:every month|monthly)$/
const MONTHLY_PREFIX = /^(?:every month|monthly) (.+)$/
const ORDINAL_DAY = /^(?:on )?(?:the )?(\d{1,2})(?:st|nd|rd|th)(?: of (?:the |every )?month)?$/
const DAY_NUMBER = /^(?:on )?day (\d{1,2})$/
const FIRST_OF_MONTH = /^(?:the )?first of (?:the |every )?month$/
const NAMED_DAY = /^(?:every |on )?([a-z]+)$/

const DAY_NUMBERS: Readonly<Record<string, number>> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

const normalize = (text: string): string => {
  const collapsed = text.toLowerCase().replace(SPACES, ' ').trim()
  return collapsed.replace(TRAILING_PUNCTUATION, '').trim()
}

const singular = (word: string): string => (word.endsWith('s') ? word.slice(0, -1) : word)

const ready = (expression: string): ExpressionRead => ({ ok: true, expression })

const refused = (reason: string): ExpressionRead => ({ ok: false, reason })

const intervalField = (step: number): string => (step === 1 ? STAR : `*/${step}`)

const dayExpression = ({
  clock,
  daysOfMonth,
  daysOfWeek,
}: {
  clock: Clock
  daysOfMonth: string
  daysOfWeek: string
}): string => `${clock.minute} ${clock.hour} ${daysOfMonth} ${STAR} ${daysOfWeek}`

const dailyExpression = (clock: Clock): string =>
  dayExpression({ clock, daysOfMonth: STAR, daysOfWeek: STAR })

const weekdayExpression = (clock: Clock): string =>
  dayExpression({ clock, daysOfMonth: STAR, daysOfWeek: WEEKDAYS })

const weeklyExpression = ({ clock, day }: { clock: Clock; day: number }): string =>
  dayExpression({ clock, daysOfMonth: STAR, daysOfWeek: String(day) })

const monthlyExpression = ({ clock, day }: { clock: Clock; day: number }): string =>
  dayExpression({ clock, daysOfMonth: String(day), daysOfWeek: STAR })

const minuteIntervalExpression = (step: number): string =>
  `${intervalField(step)} ${STAR} ${STAR} ${STAR} ${STAR}`

const hourIntervalExpression = ({ step, clock }: { step: number; clock: Clock }): string =>
  `${clock.minute} ${intervalField(step)} ${STAR} ${STAR} ${STAR}`

const hourlyAtExpression = (minute: number): string => `${minute} ${STAR} ${STAR} ${STAR} ${STAR}`

const minuteIntervalResult = (step: number): ExpressionRead =>
  step < 1 || step > MAX_MINUTE_STEP
    ? refused(MINUTE_STEP_REASON)
    : ready(minuteIntervalExpression(step))

const hourIntervalResult = ({ step, clock }: { step: number; clock: Clock }): ExpressionRead =>
  step < 1 || step > MAX_HOUR_STEP
    ? refused(HOUR_STEP_REASON)
    : ready(hourIntervalExpression({ step, clock }))

const dayOfMonthResult = ({ day, clock }: { day: number; clock: Clock }): ExpressionRead =>
  day < FIRST_DAY_OF_MONTH || day > LAST_DAY_OF_MONTH
    ? refused(DAY_REASON)
    : ready(monthlyExpression({ clock, day }))

const namedDayResult = ({
  text,
  clock,
}: {
  text: string
  clock: Clock
}): ExpressionRead | undefined => {
  const match = NAMED_DAY.exec(text)
  if (match === null) return undefined
  const day = DAY_NUMBERS[singular(match[1] ?? '')]
  if (day === undefined) return undefined
  return ready(weeklyExpression({ clock, day }))
}

const readExpression = ({
  text,
  clock,
}: {
  text: string
  clock: Clock
}): ExpressionRead | undefined => {
  if (DAILY.test(text)) return ready(dailyExpression(clock))
  if (WEEKDAY.test(text)) return ready(weekdayExpression(clock))
  if (MONTHLY.test(text)) return ready(monthlyExpression({ clock, day: FIRST_DAY_OF_MONTH }))
  const monthlyPrefix = MONTHLY_PREFIX.exec(text)
  if (monthlyPrefix !== null) return readExpression({ text: monthlyPrefix[1] ?? '', clock })
  const minuteStep = MINUTE_INTERVAL.exec(text)
  if (minuteStep !== null) return minuteIntervalResult(Number(minuteStep[1] ?? ''))
  const hourStep = HOUR_INTERVAL.exec(text)
  if (hourStep !== null) return hourIntervalResult({ step: Number(hourStep[1] ?? ''), clock })
  if (EVERY_MINUTE.test(text)) return ready(minuteIntervalExpression(1))
  const hourlyAt = HOURLY_AT_MINUTE.exec(text)
  if (hourlyAt !== null) return ready(hourlyAtExpression(Number(hourlyAt[1] ?? '')))
  if (HOURLY.test(text)) return ready(hourIntervalExpression({ step: 1, clock }))
  const ordinal = ORDINAL_DAY.exec(text) ?? DAY_NUMBER.exec(text)
  if (ordinal !== null) return dayOfMonthResult({ day: Number(ordinal[1] ?? ''), clock })
  if (FIRST_OF_MONTH.test(text)) return ready(monthlyExpression({ clock, day: FIRST_DAY_OF_MONTH }))
  return namedDayResult({ text, clock })
}

const scheduleOf = (expression: string): ParsedScheduleText => {
  const parsed = parseCron(expression)
  if (parsed.ok) return { ok: true, cron: parsed.cron }
  return { ok: false, reason: `I read that as "${expression}", which is not a schedule I can run.` }
}

const cronFallbackOf = (text: string): ParsedScheduleText | undefined => {
  const fields = text.split(' ')
  if (fields.length !== CRON_FIELD_COUNT) return undefined
  if (!CRON_MINUTE_FIELD.test(fields[0] ?? '')) return undefined
  if (!fields.every((field) => CRON_FIELD.test(field))) return undefined
  const parsed = parseCron(text)
  if (parsed.ok) return { ok: true, cron: parsed.cron }
  return { ok: false, reason: `${CRON_REASON} ${parsed.reason}.` }
}

export const parseScheduleText = (text: string): ParsedScheduleText => {
  const normalized = normalize(text)
  if (normalized === '') return { ok: false, reason: EMPTY_REASON }
  const extracted = extractClock(normalized)
  if (!extracted.ok) return { ok: false, reason: extracted.reason }
  const rest = normalize(extracted.rest)
  if (rest === '') return scheduleOf(dailyExpression(extracted.clock))
  const read = readExpression({ text: rest, clock: extracted.clock })
  if (read === undefined)
    return cronFallbackOf(normalized) ?? { ok: false, reason: UNREADABLE_REASON }
  if (!read.ok) return { ok: false, reason: read.reason }
  return scheduleOf(read.expression)
}
