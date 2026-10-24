import { describe, expect, it } from 'bun:test'

import { clockTimeOf, spanMsOf } from '../clock-time'

const at = (hours: number, minutes: number, seconds = 0) =>
  new Date(2026, 9, 24, hours, minutes, seconds).toISOString()

describe('clockTimeOf', () => {
  it('formats local time as zero-padded 24h HH:MM', () => {
    expect(clockTimeOf(at(14, 5))).toBe('14:05')
    expect(clockTimeOf(at(0, 9))).toBe('00:09')
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
