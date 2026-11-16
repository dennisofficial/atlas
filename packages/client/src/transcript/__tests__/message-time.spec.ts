import { describe, expect, it } from 'bun:test'

import { messageTimeOf } from '../message-time'

const now = new Date(2026, 10, 16, 10, 0).getTime()
const sentAt = (args: {
  month: number
  day: number
  hour: number
  minute: number
  year?: number
}) => new Date(args.year ?? 2026, args.month, args.day, args.hour, args.minute).toISOString()

describe('messageTimeOf', () => {
  it('shows only the clock time for a message sent today', () => {
    expect(messageTimeOf({ at: sentAt({ month: 10, day: 16, hour: 0, minute: 5 }), now })).toBe(
      '12:05 AM',
    )
    expect(messageTimeOf({ at: sentAt({ month: 10, day: 16, hour: 9, minute: 30 }), now })).toBe(
      '9:30 AM',
    )
  })

  it('says Yesterday for the previous calendar day, even minutes before midnight', () => {
    expect(messageTimeOf({ at: sentAt({ month: 10, day: 15, hour: 23, minute: 59 }), now })).toBe(
      'Yesterday 11:59 PM',
    )
  })

  it('names the weekday for messages within the last week', () => {
    expect(messageTimeOf({ at: sentAt({ month: 10, day: 13, hour: 19, minute: 24 }), now })).toBe(
      'Friday 7:24 PM',
    )
    expect(messageTimeOf({ at: sentAt({ month: 10, day: 10, hour: 8, minute: 0 }), now })).toBe(
      'Tuesday 8:00 AM',
    )
  })

  it('shows the date for older messages this year', () => {
    expect(messageTimeOf({ at: sentAt({ month: 10, day: 9, hour: 14, minute: 1 }), now })).toBe(
      'Nov 9 2:01 PM',
    )
  })

  it('shows the date with the year for messages from an earlier year', () => {
    expect(
      messageTimeOf({ at: sentAt({ year: 2025, month: 2, day: 4, hour: 14, minute: 1 }), now }),
    ).toBe('Mar 4, 2025')
  })

  it('keeps the weekday across a new year when the message is recent', () => {
    const newYear = new Date(2027, 0, 2, 9, 0).getTime()
    expect(
      messageTimeOf({
        at: sentAt({ year: 2026, month: 11, day: 31, hour: 22, minute: 0 }),
        now: newYear,
      }),
    ).toBe('Thursday 10:00 PM')
  })

  it('has nothing to show without a usable stamp', () => {
    expect(messageTimeOf({ at: undefined, now })).toBeUndefined()
    expect(messageTimeOf({ at: 'not a date', now })).toBeUndefined()
  })
})
