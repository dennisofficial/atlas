import { describe, expect, it } from 'bun:test'

import { stopSession } from '../stop-session'

describe('stopSession', () => {
  it('stops the session once', async () => {
    const calls: unknown[] = []
    const notices: string[] = []
    await stopSession({
      api: {
        stop: (input) => {
          calls.push(input)
          return Promise.resolve({ inboxId: 2 })
        },
      },
      sessionId: 's1',
      notify: (message) => notices.push(message),
    })
    expect(calls).toEqual([{ sessionId: 's1' }])
    expect(notices).toEqual([])
  })

  it('reports a failed stop instead of throwing', async () => {
    const notices: string[] = []
    await stopSession({
      api: { stop: () => Promise.reject(new Error('nope')) },
      sessionId: 's1',
      notify: (message) => notices.push(message),
    })
    expect(notices).toEqual(['nope'])
  })
})
