import { describe, expect, it } from 'bun:test'

import { clockTimeOf, spanMsOf } from '../clock-time'

const at = (hours: number, minutes: number, seconds = 0) =>
  new Date(2026, 9, 24, hours, minutes, seconds).toISOString()

describe('clockTimeOf', () => {
  it('formats local time as 12-hour h:MM with AM/PM', () => {
    expect(clockTimeOf(at(14, 5))).toBe('2:05 PM')
    expect(clockTimeOf(at(9, 30))).toBe('9:30 AM')
    expect(clockTimeOf(at(23, 59))).toBe('11:59 PM')
  })

  it('shows midnight as 12 AM and noon as 12 PM', () => {
    expect(clockTimeOf(at(0, 9))).toBe('12:09 AM')
    expect(clockTimeOf(at(12, 0))).toBe('12:00 PM')
    expect(clockTimeOf(at(12, 45))).toBe('12:45 PM')
  })

  it('is undefined for a missing or unparseable stamp', () => {
    expect(clockTimeOf(undefined)).toBeUndefined()
    expect(clockTimeOf('not a date')).toBeUndefined()
  })
})

describe('spanMsOf', () => {
  const base = {
    startedAt: at(10, 0),
    endedAt: at(10, 0, 30),
    now: Date.parse(at(10, 5)),
  }

  it('measures a finished turn from start to end', () => {
    expect(spanMsOf({ ...base, running: false })).toBe(30_000)
  })

  it('measures a running turn to now', () => {
    expect(spanMsOf({ ...base, running: true })).toBe(300_000)
  })

  it('is zero without a start or an end', () => {
    expect(spanMsOf({ ...base, startedAt: undefined, running: false })).toBe(0)
    expect(spanMsOf({ ...base, endedAt: undefined, running: false })).toBe(0)
  })
})
