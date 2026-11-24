import { describe, expect, it } from 'bun:test'

import { retrySession } from '../retry-session'

describe('retrySession', () => {
  it('retries the session once', async () => {
    const calls: unknown[] = []
    const notices: string[] = []
    const retried = await retrySession({
      api: {
        retry: (input) => {
          calls.push(input)
          return Promise.resolve({ inboxId: 1 })
        },
      },
      sessionId: 's1',
      notify: (message) => notices.push(message),
    })
    expect(retried).toBe(true)
    expect(calls).toEqual([{ sessionId: 's1' }])
    expect(notices).toEqual([])
  })

  it('retries one sub-agent when it is named', async () => {
    const calls: unknown[] = []
    await retrySession({
      api: {
        retry: (input) => {
          calls.push(input)
          return Promise.resolve({ inboxId: 2 })
        },
      },
      sessionId: 's1',
      agentId: 'a1',
      notify: () => undefined,
    })
    expect(calls).toEqual([{ sessionId: 's1', agentId: 'a1' }])
  })

  it('reports a failed retry instead of throwing', async () => {
    const notices: string[] = []
    const retried = await retrySession({
      api: { retry: () => Promise.reject(new Error('nope')) },
      sessionId: 's1',
      notify: (message) => notices.push(message),
    })
    expect(retried).toBe(false)
    expect(notices).toEqual(['nope'])
  })
})
