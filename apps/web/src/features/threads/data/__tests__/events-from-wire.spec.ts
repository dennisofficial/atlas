import { describe, expect, it } from 'bun:test'

import { BOOT_STEP_EVENT_TYPE, type WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../events-from-wire'

const wire = (args: { seq: number; type: string; body: string }): WireEvent => ({
  id: `evt_${args.seq}`,
  threadId: 'thr_1',
  seq: args.seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: args.type,
  body: args.body,
})

const said = (seq: number, text: string) =>
  wire({ seq, type: 'user-said', body: JSON.stringify({ type: 'user-said', text }) })

describe('eventsFromWire', () => {
  it('stamps the envelope onto the decoded body', () => {
    const [event] = eventsFromWire([said(4, 'hi')])
    expect(event).toMatchObject({
      type: 'user-said',
      text: 'hi',
      seq: 4,
      id: 'evt_4',
      threadId: 'thr_1',
      runId: 'run_1',
    })
  })

  it('sorts by seq', () => {
    const events = eventsFromWire([said(3, 'c'), said(1, 'a'), said(2, 'b')])
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
  })

  it('skips legacy boot rows, unknown types and unreadable bodies', () => {
    const events = eventsFromWire([
      wire({ seq: 1, type: BOOT_STEP_EVENT_TYPE, body: '{"step":"provision"}' }),
      wire({ seq: 2, type: 'brand-new-type', body: '{"type":"brand-new-type"}' }),
      wire({ seq: 3, type: 'user-said', body: 'not json' }),
      wire({ seq: 4, type: 'user-said', body: '{"type":"user-said"}' }),
      said(5, 'kept'),
    ])
    expect(events.map((event) => event.seq)).toEqual([5])
  })

  it('carries the parent run through', () => {
    const [event] = eventsFromWire([{ ...said(1, 'x'), parentRunId: 'run_0' }])
    expect(event?.parentRunId).toBe('run_0')
  })
})
