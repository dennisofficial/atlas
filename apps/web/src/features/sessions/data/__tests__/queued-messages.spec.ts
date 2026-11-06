import { describe, expect, it } from 'bun:test'

import { chainEvents, toRunId, toThreadId, type V2Body } from '@dltech/atlas-core'

import { consumedInboxIdsOf, mergeWithdrawnIntoDraft, visibleQueuedOf } from '../queued-messages'

const eventsOf = (bodies: readonly V2Body[]) =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-06T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const queued = [
  { inboxId: 1, text: 'first', postedAt: '2026-11-06T10:00:00.000Z' },
  { inboxId: 2, text: 'second', postedAt: '2026-11-06T10:00:01.000Z' },
]

describe('mergeWithdrawnIntoDraft', () => {
  it('uses the withdrawn text alone when the draft is blank', () => {
    expect(mergeWithdrawnIntoDraft({ withdrawn: 'hello', draft: '' })).toBe('hello')
    expect(mergeWithdrawnIntoDraft({ withdrawn: 'hello', draft: '  \n' })).toBe('hello')
  })

  it('puts the withdrawn text first, a blank line, then the existing draft', () => {
    expect(mergeWithdrawnIntoDraft({ withdrawn: 'hello', draft: 'typing' })).toBe('hello\n\ntyping')
  })
})

describe('visibleQueuedOf', () => {
  it('lists queued entries oldest first as composer-dock entries', () => {
    expect(visibleQueuedOf({ queued, events: [] })).toEqual([
      { id: '1', text: 'first', attachments: [] },
      { id: '2', text: 'second', attachments: [] },
    ])
  })

  it('hides an entry once its user-said carrying the inbox request id is in the window', () => {
    const events = eventsOf([{ type: 'user-said', text: 'first', requestId: 'inbox:1' }])
    expect(visibleQueuedOf({ queued, events }).map((entry) => entry.id)).toEqual(['2'])
  })

  it('shows nothing without a queued field', () => {
    expect(visibleQueuedOf({ queued: undefined, events: [] })).toEqual([])
  })

  it('ignores user-said events that did not come from the inbox', () => {
    const events = eventsOf([
      { type: 'user-said', text: 'x', requestId: 'other:1' },
      { type: 'user-said', text: 'y' },
      { type: 'user-said', text: 'z', requestId: 'inbox:abc' },
    ])
    expect([...consumedInboxIdsOf(events)]).toEqual([])
  })
})
