import { describe, expect, it } from 'bun:test'

import { createLiveChatSession } from '../live-chat-session'
import { IDLE_LIVE_THREAD, type LiveThreadState } from '../live-thread-view'
import { event, flush, ticketOf } from './live-thread-fixture'

describe('live seed startup', () => {
  it('mints the ticket in parallel with the seed read', async () => {
    let seedWaiting: (() => void) | undefined
    let mintWaiting: (() => void) | undefined
    let state: LiveThreadState = IDLE_LIVE_THREAD
    const session = createLiveChatSession({
      threadId: 'thr_1',
      mint: () =>
        new Promise((resolve) => {
          mintWaiting = () => resolve(ticketOf('tkt1'))
        }),
      readSeed: () =>
        new Promise((resolve) => {
          seedWaiting = () => resolve([event(1), event(2)])
        }),
      onChange: (next) => {
        state = next
      },
    })
    try {
      session.controller.start()
      await flush()
      expect(seedWaiting).toBeDefined()
      expect(mintWaiting).toBeDefined()
      mintWaiting?.()
      await flush()
      expect(state.events).toEqual([])
      seedWaiting?.()
    } finally {
      session.controller.stop()
    }
  })
})
