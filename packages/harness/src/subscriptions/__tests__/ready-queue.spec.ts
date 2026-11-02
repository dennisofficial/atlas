import { describe, expect, it } from 'bun:test'

import { EPrEventKind, toThreadId, type EventDraft } from '@dltech/atlas-core'

import { ReadyQueue } from '../ready-queue'

const THREAD = toThreadId('thread-under-test')

const merged: EventDraft = {
  type: 'pr-event',
  repo: 'github.com/compai/app',
  prNumber: 42,
  kind: EPrEventKind.State,
  url: 'https://github.com/compai/app/pull/42',
  eventId: 'evt-merged',
}

const started: EventDraft = { type: 'service-started', serviceId: 'svc_1', command: 'sleep 30' }

describe('the subscription ready queue as a wake-up bell', () => {
  it('wakes the turn when a captured draft is turn-taking', () => {
    const queue = new ReadyQueue()
    queue.enqueue({ threadId: THREAD, subscriptionId: 'sub-1', drafts: [merged] })

    expect(queue.prepare({ threadId: THREAD }).wakesTurn).toBe(true)
  })

  it('does not wake the turn when no captured draft is turn-taking', () => {
    const queue = new ReadyQueue()
    queue.enqueue({ threadId: THREAD, subscriptionId: 'sub-1', drafts: [started] })

    expect(queue.prepare({ threadId: THREAD }).wakesTurn).toBe(false)
  })

  it('does not wake the turn for another thread', () => {
    const queue = new ReadyQueue()
    queue.enqueue({ threadId: toThreadId('other'), subscriptionId: 'sub-1', drafts: [merged] })

    expect(queue.prepare({ threadId: THREAD }).wakesTurn).toBe(false)
  })
})
