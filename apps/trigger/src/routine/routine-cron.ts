import {
  CronNeverFiresError,
  type Cron,
  minimumGapMinutes,
  nextOccurrenceAfter,
  parseCron,
} from '@dltech/atlas-schedule'

export const MAX_WEDGED_MS = 2 * 60 * 60 * 1000

const MS_PER_MINUTE = 60_000

export const cronOf = (expression: string): Cron => {
  const parsed = parseCron(expression)
  if (!parsed.ok) throw new Error(`routine cron "${expression}" does not parse: ${parsed.reason}`)
  return parsed.cron
}

export const wedgedAfterMs = (cron: Cron): number =>
  Math.min(minimumGapMinutes(cron) * MS_PER_MINUTE, MAX_WEDGED_MS)

export const nextOccurrenceFrom = (params: {
  cron: Cron
  timezone: string
  after: string
}): string =>
  nextOccurrenceAfter({
    cron: params.cron,
    timezone: params.timezone,
    after: new Date(params.after),
  }).toISOString()

const laterOf = (left: string, right: string): string =>
  Date.parse(left) > Date.parse(right) ? left : right

export const nextRunAtAfterFailure = (params: {
  cronExpression: string
  timezone: string
  scheduledFor: string
  now: string
}): string => {
  const after = laterOf(params.now, params.scheduledFor)
  const parsed = parseCron(params.cronExpression)
  if (!parsed.ok) return new Date(Date.parse(after) + MAX_WEDGED_MS).toISOString()
  try {
    return nextOccurrenceFrom({ cron: parsed.cron, timezone: params.timezone, after })
  } catch (error) {
    if (!(error instanceof CronNeverFiresError)) throw error
    return new Date(Date.parse(after) + wedgedAfterMs(parsed.cron)).toISOString()
  }
}
