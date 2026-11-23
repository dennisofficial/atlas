import { describe, expect, it } from 'bun:test'

import { isRecentProject, lastActivityAt, RECENT_PROJECT_WINDOW_MS } from '../project-recency'

const HOUR_MS = 3_600_000
const NOW = Date.parse('2026-11-09T12:00:00.000Z')
const hoursAgo = (hours: number): string => new Date(NOW - hours * HOUR_MS).toISOString()

describe('lastActivityAt', () => {
  it('takes the newest of the project creation and its session stamps', () => {
    expect(lastActivityAt({ createdAt: hoursAgo(500), stamps: [hoursAgo(1)] })).toBe(NOW - HOUR_MS)
    expect(lastActivityAt({ createdAt: hoursAgo(5), stamps: [hoursAgo(400)] })).toBe(
      NOW - 5 * HOUR_MS,
    )
  })

  it('treats an unset stamp as no activity and an unparseable one as the newest', () => {
    expect(lastActivityAt({ createdAt: undefined, stamps: [null, undefined] })).toBe(
      Number.NEGATIVE_INFINITY,
    )
    expect(lastActivityAt({ createdAt: hoursAgo(5), stamps: ['nope'] })).toBe(
      Number.POSITIVE_INFINITY,
    )
  })
})

describe('isRecentProject', () => {
  it('keeps a project inside 72h of activity and drops one past it', () => {
    expect(
      isRecentProject({
        createdAt: new Date(NOW - RECENT_PROJECT_WINDOW_MS).toISOString(),
        stamps: [],
        now: NOW,
      }),
    ).toBe(true)
    expect(
      isRecentProject({
        createdAt: new Date(NOW - RECENT_PROJECT_WINDOW_MS - 1).toISOString(),
        stamps: [],
        now: NOW,
      }),
    ).toBe(false)
  })

  it('counts an old project recent while one of its sessions moved', () => {
    expect(isRecentProject({ createdAt: hoursAgo(900), stamps: [hoursAgo(2)], now: NOW })).toBe(
      true,
    )
    expect(isRecentProject({ createdAt: hoursAgo(900), stamps: [hoursAgo(90)], now: NOW })).toBe(
      false,
    )
  })
})
