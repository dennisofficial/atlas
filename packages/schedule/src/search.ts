import { dayMatches, type WallDate } from './calendar'
import { type Cron, CronNeverFiresError } from './cron'
import { instantFor, wallClockAt, type WallClock } from './timezone'

const MS_PER_DAY = 86_400_000
const SEARCH_DAYS = 5 * 366
const DAY_START_SECOND = 0

const utcDayStart = (wall: WallClock): number => Date.UTC(wall.year, wall.month - 1, wall.day)

const wallDateOf = (dayStart: number): WallDate => {
  const date = new Date(dayStart)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    dayOfMonth: date.getUTCDate(),
    dayOfWeek: date.getUTCDay(),
  }
}

const firstCandidateOnDay = ({
  cron,
  dayStart,
  after,
  timezone,
  skip,
}: {
  cron: Cron
  dayStart: number
  after: number
  timezone: string
  skip: WallClock | undefined
}): number | undefined => {
  const date = wallDateOf(dayStart)
  for (const hour of cron.hours) {
    if (skip !== undefined && hour < skip.hour) continue
    for (const minute of cron.minutes) {
      if (skip !== undefined && hour === skip.hour && minute <= skip.minute) continue
      const instant = instantFor({
        wall: {
          year: date.year,
          month: date.month,
          day: date.dayOfMonth,
          hour,
          minute,
          second: DAY_START_SECOND,
        },
        timezone,
      })
      if (instant > after) return instant
    }
  }
  return undefined
}

export const nextOccurrenceAfter = ({
  cron,
  after,
  timezone,
}: {
  cron: Cron
  after: Date
  timezone: string
}): Date => {
  const afterInstant = after.getTime()
  const start = wallClockAt({ instant: afterInstant, timezone })
  const firstDay = utcDayStart(start)
  for (let offset = 0; offset < SEARCH_DAYS; offset += 1) {
    const dayStart = firstDay + offset * MS_PER_DAY
    if (!dayMatches({ cron, wall: wallDateOf(dayStart) })) continue
    const found = firstCandidateOnDay({
      cron,
      dayStart,
      after: afterInstant,
      timezone,
      skip: offset === 0 ? start : undefined,
    })
    if (found !== undefined) return new Date(found)
  }
  throw new CronNeverFiresError({ expression: cron.expression })
}

export const upcomingOccurrences = ({
  cron,
  after,
  timezone,
  count,
}: {
  cron: Cron
  after: Date
  timezone: string
  count: number
}): Date[] => {
  const occurrences: Date[] = []
  let cursor = new Date(after.getTime())
  for (let index = 0; index < count; index += 1) {
    cursor = nextOccurrenceAfter({ cron, after: cursor, timezone })
    occurrences.push(cursor)
  }
  return occurrences
}
