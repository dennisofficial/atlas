import { describe, expect, it } from 'bun:test'

import { CronNeverFiresError } from '../cron'
import { parseCron } from '../parse'
import { nextOccurrenceAfter, upcomingOccurrences } from '../search'

const cronOf = (expression: string) => {
  const parsed = parseCron(expression)
  if (!parsed.ok) throw new Error(`expected "${expression}" to parse: ${parsed.reason}`)
  return parsed.cron
}

const nextIso = ({
  expression,
  after,
  timezone,
}: {
  expression: string
  after: string
  timezone: string
}): string =>
  nextOccurrenceAfter({
    cron: cronOf(expression),
    after: new Date(after),
    timezone,
  }).toISOString()

describe('nextOccurrenceAfter arithmetic', () => {
  it('finds the next daily run in UTC', () => {
    expect(
      nextIso({ expression: '0 12 * * *', after: '2026-11-10T00:00:00Z', timezone: 'UTC' }),
    ).toBe('2026-11-10T12:00:00.000Z')
  })

  it('is strictly after the reference instant', () => {
    expect(
      nextIso({ expression: '0 12 * * *', after: '2026-11-10T12:00:00Z', timezone: 'UTC' }),
    ).toBe('2026-11-11T12:00:00.000Z')
  })

  it('skips months that are too short for the 31st', () => {
    expect(
      nextIso({ expression: '0 12 31 * *', after: '2026-04-01T00:00:00Z', timezone: 'UTC' }),
    ).toBe('2026-05-31T12:00:00.000Z')
  })

  it('rolls past June to July for the 31st', () => {
    expect(
      nextIso({ expression: '0 12 31 * *', after: '2026-05-31T12:00:00Z', timezone: 'UTC' }),
    ).toBe('2026-07-31T12:00:00.000Z')
  })

  it('finds the next leap day', () => {
    expect(
      nextIso({ expression: '0 0 29 2 *', after: '2026-01-01T00:00:00Z', timezone: 'UTC' }),
    ).toBe('2028-02-29T00:00:00.000Z')
  })

  it('crosses the year boundary', () => {
    expect(
      nextIso({ expression: '0 0 1 1 *', after: '2026-06-01T00:00:00Z', timezone: 'UTC' }),
    ).toBe('2027-01-01T00:00:00.000Z')
  })

  it('takes the union of day-of-month and day-of-week when both are restricted', () => {
    expect(
      nextIso({ expression: '0 0 13 * 5', after: '2026-11-01T00:00:00Z', timezone: 'UTC' }),
    ).toBe('2026-11-06T00:00:00.000Z')
    expect(
      nextIso({ expression: '0 0 13 * 5', after: '2026-11-14T00:00:00Z', timezone: 'UTC' }),
    ).toBe('2026-11-20T00:00:00.000Z')
    expect(
      nextIso({ expression: '0 0 13 * 5', after: '2026-12-12T00:00:00Z', timezone: 'UTC' }),
    ).toBe('2026-12-13T00:00:00.000Z')
  })

  it('takes only the weekday when day-of-month is a wildcard', () => {
    expect(
      nextIso({ expression: '0 0 * * 5', after: '2026-11-14T00:00:00Z', timezone: 'UTC' }),
    ).toBe('2026-11-20T00:00:00.000Z')
  })

  it('takes only the day-of-month when day-of-week is a wildcard', () => {
    expect(
      nextIso({ expression: '0 0 25 * *', after: '2026-11-14T00:00:00Z', timezone: 'UTC' }),
    ).toBe('2026-11-25T00:00:00.000Z')
  })

  it('steps hours', () => {
    expect(
      nextIso({ expression: '0 */6 * * *', after: '2026-11-10T07:30:00Z', timezone: 'UTC' }),
    ).toBe('2026-11-10T12:00:00.000Z')
    expect(
      nextIso({ expression: '0 */6 * * *', after: '2026-11-10T18:00:00Z', timezone: 'UTC' }),
    ).toBe('2026-11-11T00:00:00.000Z')
  })

  it('reads the expression in the given timezone, not in UTC', () => {
    const args = { expression: '0 9 * * *', after: '2026-06-01T00:00:00Z' }
    expect(nextIso({ ...args, timezone: 'UTC' })).toBe('2026-06-01T09:00:00.000Z')
    expect(nextIso({ ...args, timezone: 'Europe/Berlin' })).toBe('2026-06-01T07:00:00.000Z')
    expect(nextIso({ ...args, timezone: 'America/New_York' })).toBe('2026-06-01T13:00:00.000Z')
  })

  it('follows the same zone across a seasonal offset change', () => {
    const args = { expression: '0 9 * * *', timezone: 'Europe/Berlin' }
    expect(nextIso({ ...args, after: '2026-03-01T00:00:00Z' })).toBe('2026-03-01T08:00:00.000Z')
    expect(nextIso({ ...args, after: '2026-04-01T00:00:00Z' })).toBe('2026-04-01T07:00:00.000Z')
  })
})

describe('upcomingOccurrences', () => {
  it('returns consecutive occurrences in ascending order', () => {
    const occurrences = upcomingOccurrences({
      cron: cronOf('*/15 * * * *'),
      after: new Date('2026-11-10T00:05:00Z'),
      timezone: 'UTC',
      count: 4,
    })
    expect(occurrences.map((occurrence) => occurrence.toISOString())).toEqual([
      '2026-11-10T00:15:00.000Z',
      '2026-11-10T00:30:00.000Z',
      '2026-11-10T00:45:00.000Z',
      '2026-11-10T01:00:00.000Z',
    ])
  })

  it('returns nothing for a non positive count', () => {
    const cron = cronOf('0 0 * * *')
    expect(
      upcomingOccurrences({
        cron,
        after: new Date('2026-11-10T00:00:00Z'),
        timezone: 'UTC',
        count: 0,
      }),
    ).toEqual([])
  })

  it('keeps a multi day cadence across a month boundary', () => {
    const occurrences = upcomingOccurrences({
      cron: cronOf('0 0 31 * *'),
      after: new Date('2026-08-01T00:00:00Z'),
      timezone: 'UTC',
      count: 3,
    })
    expect(occurrences.map((occurrence) => occurrence.toISOString())).toEqual([
      '2026-08-31T00:00:00.000Z',
      '2026-10-31T00:00:00.000Z',
      '2026-12-31T00:00:00.000Z',
    ])
  })
})

describe('the five year search bound', () => {
  it('throws CronNeverFiresError for a day February never has', () => {
    expect(() =>
      nextOccurrenceAfter({
        cron: cronOf('0 0 30 2 *'),
        after: new Date('2026-01-01T00:00:00Z'),
        timezone: 'UTC',
      }),
    ).toThrow(CronNeverFiresError)
  })

  it('names the expression on the error', () => {
    try {
      nextOccurrenceAfter({
        cron: cronOf('0 0 31 4 *'),
        after: new Date('2026-01-01T00:00:00Z'),
        timezone: 'UTC',
      })
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(CronNeverFiresError)
      expect((error as CronNeverFiresError).expression).toBe('0 0 31 4 *')
      expect((error as CronNeverFiresError).name).toBe('CronNeverFiresError')
    }
  })
})
