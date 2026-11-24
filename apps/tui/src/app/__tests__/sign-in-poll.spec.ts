import { describe, expect, it } from 'bun:test'

import { pollSignInUntilSettled } from '../sign-in-poll'

const clock = (): { now: () => number; wait: (ms: number) => Promise<void> } => {
  let at = 0
  return {
    now: () => at,
    wait: async (ms) => {
      at += ms
    },
  }
}

describe('pollSignInUntilSettled', () => {
  it('returns the first answer that is not pending', async () => {
    const answers = ['pending', 'pending', 'complete']
    const time = clock()

    const result = await pollSignInUntilSettled({
      intervalMs: 10,
      expiresInMs: 1_000,
      poll: async () => ({ status: answers.shift() ?? 'pending' }),
      wait: time.wait,
      now: time.now,
      isCancelled: () => false,
    })

    expect(result).toEqual({ status: 'complete' })
  })

  it('answers expired once the deadline passes', async () => {
    const time = clock()

    const result = await pollSignInUntilSettled({
      intervalMs: 100,
      expiresInMs: 250,
      poll: async () => ({ status: 'pending' }),
      wait: time.wait,
      now: time.now,
      isCancelled: () => false,
    })

    expect(result).toEqual({ status: 'expired' })
  })

  it('answers null when the drawer closed mid-poll', async () => {
    const time = clock()

    const result = await pollSignInUntilSettled({
      intervalMs: 10,
      expiresInMs: 1_000,
      poll: async () => ({ status: 'complete' }),
      wait: time.wait,
      now: time.now,
      isCancelled: () => true,
    })

    expect(result).toBeNull()
  })
})
