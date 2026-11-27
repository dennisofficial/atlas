import { describe, expect, it } from 'bun:test'

import { signInRetryMessageOf } from '../use-sign-in-retry'

describe('the message Try again sends', () => {
  it('asks the agent to run the sign-in for the server again', () => {
    expect(signInRetryMessageOf('linear')).toEqual({
      text: 'Sign in to linear again',
      media: [],
      uploads: [],
    })
  })
})
