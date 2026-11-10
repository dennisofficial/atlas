import { describe, expect, it } from 'bun:test'

import { cronOf, isKnownTimezone, nextOccurrencesOf, scheduleSummaryOf } from '../routine-schedule'

const LONDON = 'Europe/London'
const UTC = 'UTC'

describe('cronOf', () => {
  it('reads the five fields of a weekday morning', () => {
    const cron = cronOf('0 7 * * 1-5')
    expect(cron?.minutes).toEqual([0])
    expect(cron?.hours).toEqual([7])
    expect(cron?.daysOfWeek).toEqual([1, 2, 3, 4, 5])
    expect(cron?.months).toHaveLength(12)
  })

  it('expands stars and steps', () => {
    expect(cronOf('*/15 * * * *')?.minutes).toEqual([0, 15, 30, 45])
    expect(cronOf('* * * * *')?.hours).toHaveLength(24)
  })

  it('rejects anything it cannot read', () => {
    expect(cronOf('0 7 * *')).toBeNull()
    expect(cronOf('0 25 * * *')).toBeNull()
    expect(cronOf('every morning')).toBeNull()
    expect(cronOf('0 7 * * 8')).toBeNull()
  })
})

describe('isKnownTimezone', () => {
  it('accepts an IANA zone and refuses a half-typed one', () => {
    expect(isKnownTimezone(LONDON)).toBe(true)
    expect(isKnownTimezone('Europe/')).toBe(false)
    expect(isKnownTimezone('')).toBe(false)
  })
})

describe('scheduleSummaryOf', () => {
  it('names the everyday shapes', () => {
    expect(scheduleSummaryOf('0 7 * * 1-5')).toBe('Every weekday at 07:00')
    expect(scheduleSummaryOf('0 9 * * *')).toBe('Every day at 09:00')
    expect(scheduleSummaryOf('0 3 * * 1')).toBe('Every Monday at 03:00')
    expect(scheduleSummaryOf('0 8 1 * *')).toBe('Monthly on the 1st at 08:00')
    expect(scheduleSummaryOf('0 * * * *')).toBe('Every hour at :00')
  })

  it('states a repeated minute as the gap between runs', () => {
    expect(scheduleSummaryOf('*/15 * * * *')).toBe('Every 15 minutes')
    expect(scheduleSummaryOf('0,20,40 * * * *')).toBe('Every 20 minutes')
    expect(scheduleSummaryOf('* * * * *')).toBe('Every minute')
  })

  it('hands the expression back when it cannot translate it', () => {
    expect(scheduleSummaryOf('0 7 1 * 1')).toBe('0 7 1 * 1')
    expect(scheduleSummaryOf('0 7 * 12 *')).toBe('0 7 * 12 *')
    expect(scheduleSummaryOf('0,10,25 * * * *')).toBe('0,10,25 * * * *')
    expect(scheduleSummaryOf('not a cron')).toBe('not a cron')
  })
})

describe('nextOccurrencesOf', () => {
  it('lists the next weekday mornings after a Monday evening', () => {
    expect(
      nextOccurrencesOf({
        cron: '0 7 * * 1-5',
        timeZone: LONDON,
        from: Date.parse('2026-11-09T20:00:00Z'),
        count: 3,
      }),
    ).toEqual(['2026-11-10T07:00:00.000Z', '2026-11-11T07:00:00.000Z', '2026-11-12T07:00:00.000Z'])
  })

  it('keeps the wall clock through summer time', () => {
    expect(
      nextOccurrencesOf({
        cron: '0 7 * * *',
        timeZone: LONDON,
        from: Date.parse('2026-06-01T00:00:00Z'),
        count: 1,
      }),
    ).toEqual(['2026-06-01T06:00:00.000Z'])
  })

  it('starts at the next quarter hour rather than the top of the hour', () => {
    expect(
      nextOccurrencesOf({
        cron: '*/15 * * * *',
        timeZone: UTC,
        from: Date.parse('2026-11-10T07:06:00Z'),
        count: 3,
      }),
    ).toEqual(['2026-11-10T07:15:00.000Z', '2026-11-10T07:30:00.000Z', '2026-11-10T07:45:00.000Z'])
  })

  it('waits for the month the expression names', () => {
    expect(
      nextOccurrencesOf({
        cron: '0 7 * 12 *',
        timeZone: UTC,
        from: Date.parse('2026-11-10T00:00:00Z'),
        count: 1,
      }),
    ).toEqual(['2026-12-01T07:00:00.000Z'])
  })

  it('is empty for an expression it cannot read', () => {
    expect(
      nextOccurrencesOf({
        cron: 'not a cron',
        timeZone: LONDON,
        from: Date.parse('2026-11-09T20:00:00Z'),
        count: 3,
      }),
    ).toEqual([])
  })

  it('is empty rather than throwing for a timezone it cannot read', () => {
    expect(
      nextOccurrencesOf({
        cron: '0 7 * * *',
        timeZone: 'Europe/',
        from: Date.parse('2026-11-09T20:00:00Z'),
        count: 3,
      }),
    ).toEqual([])
  })
})
