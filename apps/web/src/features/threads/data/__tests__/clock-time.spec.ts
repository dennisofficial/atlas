import { describe, expect, it } from 'bun:test'

import { spanMsOf } from '../clock-time'

const at = (hours: number, minutes: number, seconds = 0) =>
  new Date(2026, 9, 24, hours, minutes, seconds).toISOString()

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
