import { describe, expect, it } from 'bun:test'

import { presenceStateOf, sessionIdOfPathname } from '../presence-state'

describe('sessionIdOfPathname', () => {
  it('reads the session of a session route', () => {
    expect(sessionIdOfPathname('/sessions/session-1')).toBe('session-1')
  })

  it('tolerates a trailing slash', () => {
    expect(sessionIdOfPathname('/sessions/session-1/')).toBe('session-1')
  })

  it('decodes an escaped session id', () => {
    expect(sessionIdOfPathname('/sessions/session%2F1')).toBe('session/1')
  })

  it('answers null for every other route', () => {
    expect(sessionIdOfPathname('/')).toBeNull()
    expect(sessionIdOfPathname('/new')).toBeNull()
    expect(sessionIdOfPathname('/thread/thread-1')).toBeNull()
    expect(sessionIdOfPathname('/settings')).toBeNull()
  })
})

describe('presenceStateOf', () => {
  it('is foreground while the app is active', () => {
    expect(presenceStateOf({ sessionId: 'session-1', appState: 'active' })).toEqual({
      sessionId: 'session-1',
      foreground: true,
    })
  })

  it('is away while the app is inactive or in the background', () => {
    expect(presenceStateOf({ sessionId: 'session-1', appState: 'inactive' }).foreground).toBe(false)
    expect(presenceStateOf({ sessionId: 'session-1', appState: 'background' }).foreground).toBe(
      false,
    )
  })
})
