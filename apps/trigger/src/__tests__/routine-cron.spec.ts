import { describe, expect, it } from 'bun:test'
import { CronNeverFiresError } from '@dltech/atlas-schedule'
import {
  cronOf,
  MAX_WEDGED_MS,
  nextOccurrenceFrom,
  nextRunAtAfterFailure,
  wedgedAfterMs,
} from '../trigger/routine/routine-cron'

describe('routine cron', () => {
  it('reads the interval between two occurrences of the schedule', () => {
    expect(wedgedAfterMs(cronOf('* * * * *'))).toBe(60_000)
    expect(wedgedAfterMs(cronOf('*/15 * * * *'))).toBe(900_000)
    expect(wedgedAfterMs(cronOf('0 3 * * *'))).toBe(3_600_000)
  })

  it('never waits longer than the cap', () => {
    for (const expression of ['* * * * *', '*/15 * * * *', '0 3 * * *']) {
      expect(wedgedAfterMs(cronOf(expression))).toBeLessThanOrEqual(MAX_WEDGED_MS)
    }
  })

  it('refuses an expression it cannot parse', () => {
    expect(() => cronOf('not a cron')).toThrow('does not parse')
  })

  it('finds the next occurrence in the routine timezone', () => {
    const next = nextOccurrenceFrom({
      cron: cronOf('0 3 * * *'),
      timezone: 'America/New_York',
      after: '2026-11-10T03:00:00.000Z',
    })

    expect(next).toBe('2026-11-10T08:00:00.000Z')
  })

  it('surfaces a cron that never fires instead of inventing an occurrence', () => {
    expect(() =>
      nextOccurrenceFrom({
        cron: cronOf('0 0 30 2 *'),
        timezone: 'UTC',
        after: '2026-11-10T00:00:00.000Z',
      }),
    ).toThrow(CronNeverFiresError)
  })
})

describe('next run after a failure', () => {
  it('moves past the failed occurrence', () => {
    const next = nextRunAtAfterFailure({
      cronExpression: '0 3 * * *',
      timezone: 'UTC',
      scheduledFor: '2026-11-10T03:00:00.000Z',
      now: '2026-11-10T03:00:05.000Z',
    })

    expect(next).toBe('2026-11-11T03:00:00.000Z')
  })

  it('counts from now when the failure lands long after the occurrence', () => {
    const next = nextRunAtAfterFailure({
      cronExpression: '0 3 * * *',
      timezone: 'UTC',
      scheduledFor: '2026-11-10T03:00:00.000Z',
      now: '2026-11-13T09:00:00.000Z',
    })

    expect(next).toBe('2026-11-14T03:00:00.000Z')
  })

  it('retries one interval later when the cron can never fire', () => {
    const next = nextRunAtAfterFailure({
      cronExpression: '0 0 30 2 *',
      timezone: 'UTC',
      scheduledFor: '2026-11-10T00:00:00.000Z',
      now: '2026-11-10T00:00:05.000Z',
    })

    expect(next).toBe('2026-11-10T01:00:05.000Z')
  })

  it('retries the cap later when the stored cron does not parse', () => {
    const next = nextRunAtAfterFailure({
      cronExpression: 'not a cron',
      timezone: 'UTC',
      scheduledFor: '2026-11-10T00:00:00.000Z',
      now: '2026-11-10T00:00:05.000Z',
    })

    expect(next).toBe('2026-11-10T02:00:05.000Z')
  })
})
