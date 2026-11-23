import { describe, expect, it } from 'bun:test'

import { clearSessionIdOf } from '../dismiss-payload'

describe('clearSessionIdOf', () => {
  it('reads the session a headless clear names', () => {
    const data = { dataString: JSON.stringify({ clearSessionId: 'session-1' }) }

    expect(clearSessionIdOf(data)).toBe('session-1')
  })

  it('reads the session from a plain data object', () => {
    expect(clearSessionIdOf({ clearSessionId: 'session-2' })).toBe('session-2')
  })

  it('ignores a payload that clears nothing', () => {
    expect(
      clearSessionIdOf({ dataString: JSON.stringify({ sessionId: 'session-1' }) }),
    ).toBeUndefined()
    expect(clearSessionIdOf({ dataString: 'not json' })).toBeUndefined()
    expect(clearSessionIdOf(undefined)).toBeUndefined()
    expect(clearSessionIdOf({ clearSessionId: '' })).toBeUndefined()
  })
})
