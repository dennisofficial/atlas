import { describe, expect, it } from 'bun:test'

import { signInRetryTextOf } from '../sign-in-entry'

describe('the message Try again sends', () => {
  it('asks the agent to run the sign-in for the server again', () => {
    expect(signInRetryTextOf('linear')).toBe('Sign in to linear again')
  })
})
