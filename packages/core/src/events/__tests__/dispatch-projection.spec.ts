import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../body'
import type { Event } from '../envelope'
import { toThreadId, toCallId, toEventId, toRunId } from '../ids'
import {
  crashedCalls,
  dispatchedCalls,
  pendingCalls,
  submissionWithRequestId,
} from '../projections'
import { stampDrafts } from '../stamp'

const eventsFrom = (drafts: readonly EventDraft[]): Event[] =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_, index) => ({
      id: toEventId(`evt-${index + 1}`),
      seq: index + 1,
      threadId: toThreadId('thread-1'),
      runId: toRunId('run-1'),
      depth: 0,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })),
  })

const called = (args: { callId: string; ordinal: number }): EventDraft => ({
  type: 'tool-called',
  callId: toCallId(args.callId),
  name: 'bash',
  input: { command: 'ls' },
  ordinal: args.ordinal,
})

const dispatched = (callId: string): EventDraft => ({
  type: 'tool-dispatched',
  callId: toCallId(callId),
  name: 'bash',
})

const result = (callId: string): EventDraft => ({
  type: 'tool-result',
  callId: toCallId(callId),
  name: 'bash',
  output: 'ok',
})

describe('submissionWithRequestId', () => {
  it('finds the submission carrying the requestId', () => {
    const events = eventsFrom([
      { type: 'user-said', text: 'first try', requestId: 'req-1' },
      { type: 'user-said', text: 'something else' },
    ])

    expect(submissionWithRequestId({ events, requestId: 'req-1' })?.type).toBe('user-said')
    expect((submissionWithRequestId({ events, requestId: 'req-1' }) as { text: string }).text).toBe(
      'first try',
    )
  })

  it('returns undefined when no submission carries the requestId', () => {
    const events = eventsFrom([{ type: 'user-said', text: 'no id' }])

    expect(submissionWithRequestId({ events, requestId: 'req-9' })).toBeUndefined()
  })

  it('returns the latest occurrence when a requestId somehow appears twice', () => {
    const events = eventsFrom([
      { type: 'user-said', text: 'earlier', requestId: 'req-1' },
      { type: 'user-said', text: 'later', requestId: 'req-1' },
    ])

    const found = submissionWithRequestId({ events, requestId: 'req-1' })
    expect(found?.seq).toBe(2)
  })
})

describe('dispatchedCalls', () => {
  it('is empty without markers', () => {
    const events = eventsFrom([called({ callId: 'call-1', ordinal: 0 })])

    expect(dispatchedCalls(events).size).toBe(0)
  })

  it('collects the call ids carrying a marker', () => {
    const events = eventsFrom([
      called({ callId: 'call-1', ordinal: 0 }),
      dispatched('call-1'),
      called({ callId: 'call-2', ordinal: 1 }),
    ])

    expect([...dispatchedCalls(events)]).toEqual([toCallId('call-1')])
  })

  it('scopes a marker to the occurrence that preceded it when a call id is reused', () => {
    const events = eventsFrom([
      called({ callId: 'call-1', ordinal: 0 }),
      dispatched('call-1'),
      result('call-1'),
      called({ callId: 'call-1', ordinal: 0 }),
    ])

    expect(dispatchedCalls(events).has(toCallId('call-1'))).toBe(false)
  })
})

describe('crashedCalls', () => {
  it('is empty when no pending call carries a marker', () => {
    const events = eventsFrom([called({ callId: 'call-1', ordinal: 0 })])

    expect(crashedCalls(events)).toEqual([])
  })

  it('names a marked call with no result as crashed', () => {
    const events = eventsFrom([called({ callId: 'call-1', ordinal: 0 }), dispatched('call-1')])

    const crashed = crashedCalls(events)
    expect(crashed.map((call) => call.callId)).toEqual([toCallId('call-1')])
    expect(crashed[0]?.name).toBe('bash')
  })

  it('ignores a marked call once its result landed', () => {
    const events = eventsFrom([
      called({ callId: 'call-1', ordinal: 0 }),
      dispatched('call-1'),
      result('call-1'),
    ])

    expect(crashedCalls(events)).toEqual([])
  })

  it('ignores a marked call once its denial landed', () => {
    const events = eventsFrom([
      called({ callId: 'call-1', ordinal: 0 }),
      dispatched('call-1'),
      { type: 'tool-denied', callId: toCallId('call-1'), name: 'bash', reason: 'no' },
    ])

    expect(crashedCalls(events)).toEqual([])
  })

  it('does not let a dispatch marker settle the call', () => {
    const events = eventsFrom([called({ callId: 'call-1', ordinal: 0 }), dispatched('call-1')])

    expect(pendingCalls(events).map((call) => call.callId)).toEqual([toCallId('call-1')])
  })

  it('treats a reused call id redispatched without a marker as merely pending', () => {
    const events = eventsFrom([
      called({ callId: 'call-1', ordinal: 0 }),
      dispatched('call-1'),
      result('call-1'),
      called({ callId: 'call-1', ordinal: 0 }),
    ])

    expect(crashedCalls(events)).toEqual([])
    expect(pendingCalls(events).map((call) => call.callId)).toEqual([toCallId('call-1')])
  })
})
