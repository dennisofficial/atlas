import { describe, expect, it } from 'bun:test'

import { claimSessionTap } from '../session-tap'

const tapOf = (identifier: string, data: unknown) => ({ identifier, data })

describe('claimSessionTap', () => {
  it('routes the session a launch tap names', () => {
    const handled = new Set<string>()

    expect(
      claimSessionTap({
        handled,
        tap: tapOf('notification-1', { sessionId: 'session-1', seq: 3 }),
      }),
    ).toBe('session-1')
  })

  it('does not route the same response twice when the listener also fires', () => {
    const handled = new Set<string>()
    const tap = tapOf('notification-1', { sessionId: 'session-1', seq: 3 })

    expect(claimSessionTap({ handled, tap })).toBe('session-1')
    expect(claimSessionTap({ handled, tap })).toBeUndefined()
  })

  it('routes a second notification of the same session', () => {
    const handled = new Set<string>()

    expect(
      claimSessionTap({ handled, tap: tapOf('notification-1', { sessionId: 'session-1' }) }),
    ).toBe('session-1')
    expect(
      claimSessionTap({ handled, tap: tapOf('notification-2', { sessionId: 'session-1' }) }),
    ).toBe('session-1')
  })

  it('routes nothing for a routine tap', () => {
    const handled = new Set<string>()

    expect(
      claimSessionTap({ handled, tap: tapOf('notification-1', { routineId: 'routine-1' }) }),
    ).toBeUndefined()
    expect(handled.size).toBe(0)
  })

  it('routes nothing for a clear tap or a payload without data', () => {
    const handled = new Set<string>()

    expect(claimSessionTap({ handled, tap: tapOf('notification-1', undefined) })).toBeUndefined()
    expect(
      claimSessionTap({ handled, tap: tapOf('notification-2', { sessionId: '' }) }),
    ).toBeUndefined()
  })
})
