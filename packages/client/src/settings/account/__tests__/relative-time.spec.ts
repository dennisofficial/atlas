import { describe, expect, it } from 'bun:test'

import { monthYear, relativeTime, shortDate } from '../relative-time'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('relativeTime', () => {
  it('buckets elapsed time', () => {
    expect(relativeTime({ from: ago(10_000), now: NOW })).toBe('just now')
    expect(relativeTime({ from: ago(5 * 60_000), now: NOW })).toBe('5m ago')
    expect(relativeTime({ from: ago(3 * 3_600_000), now: NOW })).toBe('3h ago')
    expect(relativeTime({ from: ago(3 * 86_400_000), now: NOW })).toBe('3d ago')
    expect(relativeTime({ from: ago(21 * 86_400_000), now: NOW })).toBe('3w ago')
    expect(relativeTime({ from: ago(90 * 86_400_000), now: NOW })).toBe('3mo ago')
  })

  it('treats an unreadable date as just now', () => {
    expect(relativeTime({ from: 'not a date', now: NOW })).toBe('just now')
  })
})

describe('calendar labels', () => {
  it('formats a short date and a month with its year in UTC', () => {
    expect(shortDate('2026-10-20T23:30:00Z')).toBe('Oct 20')
    expect(monthYear('2026-09-23T17:58:36.683Z')).toBe('Sep 2026')
  })
})
