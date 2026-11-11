import type { Cron } from './cron'

const FIELD_COUNT = 5
const DAYS_OF_MONTH_INDEX = 2
const DAYS_OF_WEEK_INDEX = 4
const DAYS_OF_MONTH_SIZE = 31
const DAYS_OF_WEEK_SIZE = 7

export type WallDate = {
  year: number
  month: number
  dayOfMonth: number
  dayOfWeek: number
}

const restricted = ({
  expression,
  index,
  values,
  size,
}: {
  expression: string
  index: number
  values: readonly number[]
  size: number
}): boolean => {
  const fields = expression.trim().split(/\s+/)
  const field = fields[index]
  if (fields.length !== FIELD_COUNT || field === undefined) return values.length < size
  return field !== '*'
}

export const dayMatches = ({ cron, wall }: { cron: Cron; wall: WallDate }): boolean => {
  if (!cron.months.includes(wall.month)) return false
  const onDayOfMonth = cron.daysOfMonth.includes(wall.dayOfMonth)
  const onDayOfWeek = cron.daysOfWeek.includes(wall.dayOfWeek)
  const dayOfMonthRestricted = restricted({
    expression: cron.expression,
    index: DAYS_OF_MONTH_INDEX,
    values: cron.daysOfMonth,
    size: DAYS_OF_MONTH_SIZE,
  })
  const dayOfWeekRestricted = restricted({
    expression: cron.expression,
    index: DAYS_OF_WEEK_INDEX,
    values: cron.daysOfWeek,
    size: DAYS_OF_WEEK_SIZE,
  })
  if (!dayOfMonthRestricted) return onDayOfWeek
  if (!dayOfWeekRestricted) return onDayOfMonth
  return onDayOfMonth || onDayOfWeek
}
