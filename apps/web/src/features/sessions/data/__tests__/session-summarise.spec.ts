import { describe, expect, it } from 'bun:test'
import { chainEvents, toRunId, toThreadId, type V2Body } from '@dltech/atlas-core'

import { requestSummarise, summariseCopyOf, summarisePointsOf } from '../session-summarise'

const eventsOf = (bodies: readonly V2Body[]) =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-08T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const said = (text: string): V2Body => ({ type: 'user-said', text })
const replied: V2Body = { type: 'assistant-said', parts: [{ type: 'text', text: 'r' }] }

describe('session summarise', () => {
  it('offers every message but the first, reaching the event before it', () => {
    const events = eventsOf([said('a'), replied, said('b'), replied, said('c')])
    expect([...summarisePointsOf(events).values()]).toEqual([
      { throughSeq: 2, messages: 1 },
      { throughSeq: 4, messages: 2 },
    ])
  })

  it('tells the operator a rewind brings the messages back', () => {
    const { description } = summariseCopyOf({ throughSeq: 2, messages: 1 })
    expect(description).toContain('brings them back')
    expect(description).not.toContain('no longer be rewound')
  })

  it('posts the summarise command with the through sequence only', async () => {
    const calls: unknown[] = []
    const inboxId = await requestSummarise({
      api: {
        command: (input) => {
          calls.push(input)
          return Promise.resolve({ inboxId: 9 })
        },
      },
      sessionId: 's1',
      throughSeq: 2,
    })
    expect(calls).toEqual([{ sessionId: 's1', name: 'summarise', args: { throughSeq: 2 } }])
    expect(inboxId).toBe(9)
  })
})
