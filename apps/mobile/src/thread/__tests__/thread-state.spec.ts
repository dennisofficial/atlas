import { describe, expect, it } from 'bun:test'

import { EStepEnd } from '@dltech/atlas-client/channel'
import type { Event } from '@dltech/atlas-core'
import { ended, log, started, stepOne, textDelta } from '@dltech/atlas-client/transcript-fixture'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { headSeqOf, mergeEvents } from '../data/events'
import {
  INITIAL_THREAD_STATE,
  threadReducer,
  viewOf,
  type ThreadAction,
  type ThreadState,
} from '../data/thread-state'
import { EMessageAuthor, ERowKind } from '../rows'

const wireOf = (event: Event): WireEvent => {
  const { id, seq, threadId, runId, depth, at, parentRunId, ...body } = event
  return {
    id,
    seq,
    threadId,
    runId,
    depth,
    at,
    type: event.type,
    body: JSON.stringify(body),
    ...(parentRunId === undefined ? {} : { parentRunId }),
  }
}

const applied = (actions: readonly ThreadAction[]): ThreadState =>
  actions.reduce(threadReducer, INITIAL_THREAD_STATE)

const unreadableRow: WireEvent = {
  id: 'evt-future',
  seq: 99,
  threadId: 'thread-1',
  runId: 'run-1',
  depth: 0,
  at: '2026-11-08T20:00:05.000Z',
  type: 'from-the-future',
  body: JSON.stringify({ type: 'from-the-future' }),
}

const said = log([{ type: 'user-said', text: 'hello there' }])

const seedOf = (events: readonly Event[]): ThreadAction => ({
  type: 'seed',
  events: events.map(wireOf),
  title: 'A session',
  working: false,
})

const rowsOfState = (state: ThreadState) =>
  viewOf({ state, now: Date.parse('2026-11-08T20:00:10.000Z') }).rows

describe('threadReducer', () => {
  it('marks the thread loaded and titled on seed', () => {
    const state = applied([seedOf(said)])
    expect(state.loaded).toBe(true)
    expect(state.failed).toBe(false)
    expect(state.title).toBe('A session')
    expect(state.events).toHaveLength(1)
  })

  it('is not stale when every row of the page is readable', () => {
    expect(applied([seedOf(said)]).stale).toBe(false)
  })

  it('flips stale when the seed holds a row this app cannot read', () => {
    const state = applied([
      { type: 'seed', events: [...said.map(wireOf), unreadableRow], title: null, working: false },
    ])
    expect(state.stale).toBe(true)
  })

  it('flips stale on a catch-up page and stays stale after a readable one', () => {
    const state = applied([
      seedOf(said),
      { type: 'events', events: [unreadableRow] },
      { type: 'events', events: said.map(wireOf) },
    ])
    expect(state.stale).toBe(true)
  })

  it('recomputes stale from the full read on replace', () => {
    const state = applied([
      seedOf(said),
      { type: 'events', events: [unreadableRow] },
      { type: 'replace', events: said.map(wireOf) },
    ])
    expect(state.stale).toBe(false)
  })

  it('merges catch-up events by seq without duplicates', () => {
    const state = applied([seedOf(said), { type: 'events', events: said.map(wireOf) }])
    expect(state.events).toHaveLength(1)
    expect(headSeqOf(state.events)).toBe(1)
  })

  it('replaces the log and drops live signals on a full read', () => {
    const state = applied([
      seedOf(said),
      { type: 'signal', signal: started(stepOne) },
      { type: 'signal', signal: textDelta({ stepId: stepOne, blockId: 'b1', text: 'hi' }) },
      { type: 'replace', events: said.map(wireOf) },
    ])
    expect(state.signals).toHaveLength(0)
    expect(state.events).toHaveLength(1)
  })

  it('follows turn-working and keeps operator-input requests', () => {
    const state = applied([
      { type: 'working', working: false },
      { type: 'signal', signal: { type: 'turn-working', working: true } },
      {
        type: 'operator-input',
        request: { requestId: 'req_1', description: 'Paste the key', path: '/tmp/key' },
      },
    ])
    expect(state.working).toBe(true)
    expect(state.operatorInput).toMatchObject({ requestId: 'req_1' })
  })

  it('accumulates live tool output per call', () => {
    const state = applied([
      { type: 'signal', signal: { type: 'tool-output', callId: 'call_1' as never, text: 'a' } },
      { type: 'signal', signal: { type: 'tool-output', callId: 'call_1' as never, text: 'b' } },
    ])
    expect(state.outputs.get('call_1' as never)).toBe('ab')
  })
})

describe('viewOf', () => {
  it('turns the durable log into a user row', () => {
    const rows = rowsOfState(applied([seedOf(said)]))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: ERowKind.Message,
      author: EMessageAuthor.You,
      text: 'hello there',
    })
  })

  it('renders a streaming reply from signals before its event lands', () => {
    const state = applied([
      { type: 'signal', signal: { type: 'turn-working', working: true } },
      { type: 'signal', signal: started(stepOne) },
      {
        type: 'signal',
        signal: textDelta({ stepId: stepOne, blockId: 'b1', text: 'Hello from' }),
      },
      {
        type: 'signal',
        signal: textDelta({ stepId: stepOne, blockId: 'b1', text: ' the phone' }),
      },
    ])
    const view = viewOf({ state, now: Date.now() })
    expect(view.streaming).toBe(true)
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0]).toMatchObject({
      kind: ERowKind.Message,
      author: EMessageAuthor.Atlas,
      text: 'Hello from the phone',
      streaming: true,
    })
  })

  it('hands a finished answer over to the durable log', () => {
    const answer = log([{ type: 'assistant-said', parts: [{ type: 'text', text: 'Done.' }] }])
    const signalsOnly = applied([
      seedOf(answer),
      { type: 'signal', signal: started(stepOne) },
      { type: 'signal', signal: textDelta({ stepId: stepOne, blockId: 'b1', text: 'Done.' }) },
      {
        type: 'signal',
        signal: ended({ stepId: stepOne, end: EStepEnd.Completed, supersededBy: null }),
      },
    ])
    const view = viewOf({ state: signalsOnly, now: Date.now() })
    expect(view.streaming).toBe(false)
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0]).toMatchObject({ text: 'Done.', streaming: false })
  })
})

describe('mergeEvents', () => {
  it('keeps the newer copy of a seq and sorts by seq', () => {
    const first = said.map(wireOf)
    const merged = mergeEvents({
      current: first,
      incoming: [
        { ...first[0]!, seq: 2, id: 'evt_2' },
        { ...first[0]!, seq: 1, id: 'evt_1_edited' },
      ],
    })
    expect(merged.map((event) => event.id)).toEqual(['evt_1_edited', 'evt_2'])
  })
})
