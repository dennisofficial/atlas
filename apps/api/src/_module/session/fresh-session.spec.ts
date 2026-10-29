import { ForbiddenException } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'
import { assertFreshSession, FRESH_SESSION_WINDOW_MS } from './fresh-session'

const NOW = new Date('2026-10-29T12:00:00.000Z')
const authCreatedAgo = (ms: number | null) => ({
  userId: 'u',
  sessionId: 's',
  email: '',
  sessionCreatedAt: ms === null ? undefined : new Date(NOW.getTime() - ms),
})

describe('assertFreshSession', () => {
  it('accepts a session younger than the window', () => {
    expect(() =>
      assertFreshSession({ auth: authCreatedAgo(FRESH_SESSION_WINDOW_MS - 1), now: NOW }),
    ).not.toThrow()
  })

  it('refuses a session at or past the window with REAUTH_REQUIRED', () => {
    expect(() =>
      assertFreshSession({ auth: authCreatedAgo(FRESH_SESSION_WINDOW_MS), now: NOW }),
    ).toThrow(ForbiddenException)
  })

  it('refuses a session whose age is unknown', () => {
    expect(() => assertFreshSession({ auth: authCreatedAgo(null), now: NOW })).toThrow(
      ForbiddenException,
    )
  })
})
