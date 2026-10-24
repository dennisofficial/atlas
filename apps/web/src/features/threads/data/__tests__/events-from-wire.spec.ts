import { describe, expect, it, spyOn } from 'bun:test'

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

describe('eventsFromWire memoization', () => {
  it('returns the same Event objects for the same rows and the same array', () => {
    const rows = [said(1, 'a'), said(2, 'b')]
    const first = eventsFromWire(rows)
    expect(eventsFromWire(rows)).toBe(first)
    const second = eventsFromWire([...rows])
    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
  })

  it('parses each row once across appends', () => {
    const parse = spyOn(JSON, 'parse')
    const rows = [said(1, 'a'), said(2, 'b'), said(3, 'c')]
    eventsFromWire(rows)
    const afterFirst = parse.mock.calls.length
    expect(afterFirst).toBeGreaterThanOrEqual(3)
    const appended = [...rows, said(4, 'd')]
    eventsFromWire(appended)
    expect(parse.mock.calls.length - afterFirst).toBe(1)
    eventsFromWire([...appended, said(5, 'e'), said(6, 'f')])
    expect(parse.mock.calls.length - afterFirst).toBe(3)
    parse.mockRestore()
  })

  it('remembers a row that failed to parse', () => {
    const bad = wire({ seq: 1, type: 'user-said', body: 'not json' })
    expect(eventsFromWire([bad])).toEqual([])
    const parse = spyOn(JSON, 'parse')
    expect(eventsFromWire([bad, said(2, 'ok')])).toHaveLength(1)
    expect(parse.mock.calls.length).toBe(1)
    parse.mockRestore()
  })
})
