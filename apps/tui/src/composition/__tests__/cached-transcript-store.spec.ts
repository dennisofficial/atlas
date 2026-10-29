import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { cachedTranscripts } from '../cached-transcript-store'
import type { OpenedConversation } from '../open-conversation'

const opened: OpenedConversation = {
  threadId: toThreadId('cached-store-thread'),
  events: [],
  turns: [],
  name: null,
  started: true,
}

describe('the cached transcript store', () => {
  it('is one store per owner, holds the latest opened and notifies on change only', () => {
    const owner = {}
    const store = cachedTranscripts({ sessionOwner: owner } as never)
    expect(cachedTranscripts({ sessionOwner: owner } as never)).toBe(store)
    let notified = 0
    const stop = store.subscribe(() => (notified += 1))

    store.put(opened)
    store.put(opened)
    expect(store.snapshot()).toBe(opened)
    store.put(null)
    stop()
    store.put(opened)

    expect(notified).toBe(2)
  })
})
