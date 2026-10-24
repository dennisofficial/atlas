import { describe, expect, it } from 'bun:test'

import { sessionBodyHasUser } from '../server-session'

describe('sessionBodyHasUser', () => {
  it('is true when the body carries a user', () => {
    expect(sessionBodyHasUser({ session: { id: 's' }, user: { id: 'u' } })).toBe(true)
  })

  it('is false for a null body, missing user or null user', () => {
    expect(sessionBodyHasUser(null)).toBe(false)
    expect(sessionBodyHasUser({})).toBe(false)
    expect(sessionBodyHasUser({ user: null })).toBe(false)
  })

  it('is false for non-object bodies', () => {
    expect(sessionBodyHasUser('user')).toBe(false)
    expect(sessionBodyHasUser(undefined)).toBe(false)
  })
})
