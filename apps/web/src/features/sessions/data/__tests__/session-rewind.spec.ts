import { describe, expect, it } from 'bun:test'
import { chainEvents, toRunId, toThreadId, type V2Body } from '@dltech/atlas-core'

import { requestRewind, rewoundDraftOf, seqByEventIdOf } from '../session-rewind'

const eventsOf = (bodies: readonly V2Body[]) =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-05T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const said = (text: string): V2Body => ({ type: 'user-said', text })

describe('session rewind', () => {
  it('maps user messages to their sequence', () => {
    const events = eventsOf([
      said('a'),
      { type: 'assistant-said', parts: [{ type: 'text', text: 'b' }] },
      said('c'),
    ])
    expect([...seqByEventIdOf(events).values()]).toEqual([1, 3])
  })

  it('posts the rewind command with the sequence only', async () => {
    const calls: unknown[] = []
    const inboxId = await requestRewind({
      api: {
        command: (input) => {
          calls.push(input)
          return Promise.resolve({ inboxId: 7 })
        },
      },
      sessionId: 's1',
      toSeq: 3,
    })
    expect(calls).toEqual([{ sessionId: 's1', name: 'rewind', args: { toSeq: 3 } }])
    expect(inboxId).toBe(7)
  })

  describe('rewoundDraftOf', () => {
    it('returns the draft only when the rewind is the last event', () => {
      const rewound: V2Body = { type: 'history-rewound', toSeq: 1, draft: 'b' }
      expect(rewoundDraftOf(eventsOf([said('a'), rewound]))).toBe('b')
      expect(rewoundDraftOf(eventsOf([said('a'), rewound, said('c')]))).toBeUndefined()
      expect(
        rewoundDraftOf(eventsOf([said('a'), { type: 'history-rewound', toSeq: 1 }])),
      ).toBeUndefined()
    })
  })
})
