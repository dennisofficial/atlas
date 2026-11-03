import { describe, expect, it } from 'bun:test'

import { relativeTime } from '../relative-time'

const now = Date.parse('2026-11-03T12:00:00Z')

describe('relativeTime', () => {
  it('matches the web shell format', () => {
    expect(relativeTime({ at: '2026-11-03T11:59:30Z', now })).toBe('just now')
    expect(relativeTime({ at: '2026-11-03T11:20:00Z', now })).toBe('40m ago')
    expect(relativeTime({ at: '2026-11-03T09:00:00Z', now })).toBe('3h ago')
    expect(relativeTime({ at: '2026-10-30T12:00:00Z', now })).toBe('4d ago')
    expect(relativeTime({ at: '2026-10-13T12:00:00Z', now })).toBe('3w ago')
    expect(relativeTime({ at: '2026-06-03T12:00:00Z', now })).toBe('5mo ago')
  })

  it('treats invalid or future timestamps as just now', () => {
    expect(relativeTime({ at: 'not-a-date', now })).toBe('just now')
    expect(relativeTime({ at: '2026-11-04T12:00:00Z', now })).toBe('just now')
  })
})
