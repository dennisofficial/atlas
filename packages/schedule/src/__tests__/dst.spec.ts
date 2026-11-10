import { describe, expect, it } from 'bun:test'

import { parseCron } from '../parse'
import { nextOccurrenceAfter } from '../search'

const nextIso = ({
  expression,
  after,
  timezone,
}: {
  expression: string
  after: string
  timezone: string
}): string => {
  const parsed = parseCron(expression)
  if (!parsed.ok) throw new Error(`expected "${expression}" to parse: ${parsed.reason}`)
  return nextOccurrenceAfter({ cron: parsed.cron, after: new Date(after), timezone }).toISOString()
}

describe('America/New_York spring forward', () => {
  it('runs the 02:00 wall time at the first instant after the gap', () => {
    expect(
      nextIso({
        expression: '0 2 * * *',
        after: '2026-03-08T00:00:00Z',
        timezone: 'America/New_York',
      }),
    ).toBe('2026-03-08T07:00:00.000Z')
  })

  it('shifts a wall time inside the gap forward by the gap length', () => {
    expect(
      nextIso({
        expression: '30 2 * * *',
        after: '2026-03-08T00:00:00Z',
        timezone: 'America/New_York',
      }),
    ).toBe('2026-03-08T07:30:00.000Z')
  })

  it('uses EST the day before and EDT the day after', () => {
    expect(
      nextIso({
        expression: '0 2 * * *',
        after: '2026-03-07T00:00:00Z',
        timezone: 'America/New_York',
      }),
    ).toBe('2026-03-07T07:00:00.000Z')
    expect(
      nextIso({
        expression: '0 2 * * *',
        after: '2026-03-09T00:00:00Z',
        timezone: 'America/New_York',
      }),
    ).toBe('2026-03-09T06:00:00.000Z')
  })
})

describe('America/New_York fall back', () => {
  it('resolves an ambiguous wall time to the earlier instant', () => {
    expect(
      nextIso({
        expression: '30 1 * * *',
        after: '2026-11-01T00:00:00Z',
        timezone: 'America/New_York',
      }),
    ).toBe('2026-11-01T05:30:00.000Z')
  })

  it('does not fire the same wall time twice on the repeated hour', () => {
    expect(
      nextIso({
        expression: '30 1 * * *',
        after: '2026-11-01T05:30:00Z',
        timezone: 'America/New_York',
      }),
    ).toBe('2026-11-02T06:30:00.000Z')
  })
})

describe('Europe/Berlin spring forward', () => {
  it('runs the 02:00 wall time at the first instant after the gap', () => {
    expect(
      nextIso({
        expression: '0 2 * * *',
        after: '2026-03-29T00:00:00Z',
        timezone: 'Europe/Berlin',
      }),
    ).toBe('2026-03-29T01:00:00.000Z')
  })

  it('keeps 02:00 CET the day before the gap', () => {
    expect(
      nextIso({
        expression: '0 2 * * *',
        after: '2026-03-28T00:00:00Z',
        timezone: 'Europe/Berlin',
      }),
    ).toBe('2026-03-28T01:00:00.000Z')
  })
})

describe('Europe/Berlin fall back', () => {
  it('resolves an ambiguous wall time to the earlier instant', () => {
    expect(
      nextIso({
        expression: '30 2 * * *',
        after: '2026-10-25T00:00:00Z',
        timezone: 'Europe/Berlin',
      }),
    ).toBe('2026-10-25T00:30:00.000Z')
  })

  it('keeps 02:30 CET the day after the repeated hour', () => {
    expect(
      nextIso({
        expression: '30 2 * * *',
        after: '2026-10-25T01:30:00Z',
        timezone: 'Europe/Berlin',
      }),
    ).toBe('2026-10-26T01:30:00.000Z')
  })
})
