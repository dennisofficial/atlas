import { describe, expect, it } from 'bun:test'

import type { InboxEntry, V2Event } from '@dltech/atlas-core'

import { supersededRewindIdsOf } from '../rewind-dedupe'

const rewind = (inboxId: number, toSeq: number): InboxEntry => ({
  sessionId: 'session-1',
  inboxId,
  kind: 'command:rewind',
  payload: JSON.stringify({ toSeq }),
  postedAt: '2026-11-19T16:05:46.000Z',
  consumedSeq: null,
  senderSessionId: null,
})

const message = (inboxId: number): InboxEntry => ({
  sessionId: 'session-1',
  inboxId,
  kind: 'message',
  payload: JSON.stringify({ text: `m${inboxId}` }),
  postedAt: '2026-11-19T16:05:46.000Z',
  consumedSeq: null,
  senderSessionId: null,
})

const rewound = (seq: number, toSeq: number): V2Event =>
  ({
    seq,
    type: 'history-rewound',
    toSeq,
    draft: 'text',
  }) as unknown as V2Event

describe('supersededRewindIdsOf', () => {
  it('keeps only the last rewind to each target', () => {
    const dropped = supersededRewindIdsOf({
      entries: [rewind(43, 1500), message(44), rewind(46, 1500)],
      events: [],
    })
    expect([...dropped]).toEqual([43])
  })

  it('drops a rewind whose target was already rewound to', () => {
    const dropped = supersededRewindIdsOf({
      entries: [rewind(43, 1500)],
      events: [rewound(1546, 1499)],
    })
    expect([...dropped]).toEqual([43])
  })

  it('keeps rewinds to distinct targets and entries that are not rewinds', () => {
    const dropped = supersededRewindIdsOf({
      entries: [rewind(43, 1500), rewind(46, 1510), message(47)],
      events: [],
    })
    expect([...dropped]).toEqual([])
  })

  it('ignores a rewind with an unreadable payload', () => {
    const unreadable: InboxEntry = { ...rewind(43, 1500), payload: 'not json' }
    expect([...supersededRewindIdsOf({ entries: [unreadable], events: [] })]).toEqual([])
  })
})
