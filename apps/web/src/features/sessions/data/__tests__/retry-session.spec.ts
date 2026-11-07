import { describe, expect, it } from 'bun:test'

import { retrySession } from '../retry-session'

describe('retrySession', () => {
  it('retries the session once', async () => {
    const calls: unknown[] = []
    const notices: string[] = []
    await retrySession({
      api: {
        retry: (input) => {
          calls.push(input)
          return Promise.resolve({ inboxId: 1 })
        },
      },
      sessionId: 's1',
      notify: (message) => notices.push(message),
    })
    expect(calls).toEqual([{ sessionId: 's1' }])
    expect(notices).toEqual([])
  })

  it('reports a failed retry instead of throwing', async () => {
    const notices: string[] = []
    await retrySession({
      api: { retry: () => Promise.reject(new Error('nope')) },
      sessionId: 's1',
      notify: (message) => notices.push(message),
    })
    expect(notices).toEqual(['nope'])
  })
})
