import { describe, expect, it } from 'bun:test'

import { clockTimeOf } from '../clock-time'

describe('clockTimeOf', () => {
  it('formats a timestamp as a twelve-hour clock time', () => {
    expect(clockTimeOf(new Date(2026, 10, 9, 14, 1).toISOString())).toBe('2:01 PM')
    expect(clockTimeOf(new Date(2026, 10, 9, 9, 5).toISOString())).toBe('9:05 AM')
  })

  it('shows midnight and noon as twelve', () => {
    expect(clockTimeOf(new Date(2026, 10, 9, 0, 0).toISOString())).toBe('12:00 AM')
    expect(clockTimeOf(new Date(2026, 10, 9, 12, 0).toISOString())).toBe('12:00 PM')
  })

  it('has nothing to show without a usable stamp', () => {
    expect(clockTimeOf(undefined)).toBeUndefined()
    expect(clockTimeOf('not a date')).toBeUndefined()
  })
})
