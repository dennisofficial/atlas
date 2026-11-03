import { describe, expect, it } from 'bun:test'

import { relativeTime } from '../relative-time'

const now = Date.parse('2026-11-03T12:00:00Z')

describe('relativeTime', () => {
  it('says just now for the current minute', () => {
    expect(relativeTime({ at: '2026-11-03T12:00:00Z', now })).toBe('just now')
    expect(relativeTime({ at: '2026-11-03T11:59:30Z', now })).toBe('just now')
  })

  it('says minutes under an hour', () => {
    expect(relativeTime({ at: '2026-11-03T11:45:00Z', now })).toBe('15 min ago')
  })

  it('says hours under a day', () => {
    expect(relativeTime({ at: '2026-11-03T11:00:00Z', now })).toBe('1 hour ago')
    expect(relativeTime({ at: '2026-11-03T09:00:00Z', now })).toBe('3 hours ago')
  })

  it('says days past a day', () => {
    expect(relativeTime({ at: '2026-11-02T12:00:00Z', now })).toBe('1 day ago')
    expect(relativeTime({ at: '2026-10-30T12:00:00Z', now })).toBe('4 days ago')
  })

  it('treats invalid or future timestamps as just now', () => {
    expect(relativeTime({ at: 'not-a-date', now })).toBe('just now')
    expect(relativeTime({ at: '2026-11-04T12:00:00Z', now })).toBe('just now')
  })
})
