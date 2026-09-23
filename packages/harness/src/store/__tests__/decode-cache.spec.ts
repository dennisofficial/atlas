import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '@dltech/atlas-core'

import { decodeEventRows, EventDecodeCache } from '../decode-events'
import type { EventRow } from '../event-row'

const said = (text: string): EventDraft => ({ type: 'user-said', text })

function rowAt({
  seq,
  body,
  type = 'user-said',
  id = `event-${seq}`,
}: {
  seq: number
  body: string
  type?: string
  id?: string
}): EventRow {
  return {
    id,
    threadId: 'thread-1',
    seq,
    runId: 'run-1',
    parentRunId: null,
    depth: 0,
    at: '2026-01-01T00:00:00.000Z',
    type,
    body,
    contextSlot: null,
    contextKey: null,
    contextDigest: null,
  }
}

const validRow = (seq: number, text: string): EventRow =>
  rowAt({ seq, body: JSON.stringify(said(text)) })

describe('decodeEventRows with an EventDecodeCache', () => {
  it('serves the same event object for a row it has already decoded', () => {
    const cache = new EventDecodeCache()
    const first = decodeEventRows({ rows: [validRow(1, 'one')], cache })
    const second = decodeEventRows({ rows: [validRow(1, 'one')], cache })

    expect(second.events[0]).toBe(first.events[0])
  })

  it('does not re-parse a seen row even if the row handed back differs', () => {
    const cache = new EventDecodeCache()
    decodeEventRows({ rows: [validRow(1, 'one')], cache })

    const rewritten = decodeEventRows({ rows: [validRow(1, 'rewritten')], cache })
    const [event] = rewritten.events
    expect(event?.type).toBe('user-said')
    expect(event && 'text' in event ? event.text : null).toBe('one')
  })

  it('re-decodes a repeated row when no cache is given', () => {
    decodeEventRows({ rows: [validRow(1, 'one')] })

    const rewritten = decodeEventRows({ rows: [validRow(1, 'rewritten')] })
    const [event] = rewritten.events
    expect(event && 'text' in event ? event.text : null).toBe('rewritten')
  })

  it('serves the same gap for a row that failed to decode', () => {
    const cache = new EventDecodeCache()
    const rows = [rowAt({ seq: 1, body: '{ truncated' })]
    const first = decodeEventRows({ rows, cache })
    const second = decodeEventRows({ rows, cache })

    expect(second.unreadable[0]).toBe(first.unreadable[0])
  })

  it('never caches a row with an empty id, so corrupt envelopes stay distinct', () => {
    const cache = new EventDecodeCache()
    const rows = [
      rowAt({ seq: 1, body: '{ truncated', id: '' }),
      rowAt({ seq: 2, body: '{ also truncated', id: '' }),
    ]

    const decoded = decodeEventRows({ rows, cache })
    expect(decoded.unreadable.map((gap) => gap.seq)).toEqual([1, 2])
  })

  it('evicts the oldest rows once it holds more than its byte cap', () => {
    const big = (seq: number) => rowAt({ seq, body: JSON.stringify(said('x'.repeat(100))) })
    const cache = new EventDecodeCache(700)

    decodeEventRows({ rows: [big(1)], cache })
    decodeEventRows({ rows: [big(2)], cache })
    decodeEventRows({ rows: [big(3)], cache })

    const [evicted] = decodeEventRows({ rows: [validRow(1, 'changed')], cache }).events
    expect(evicted && 'text' in evicted ? evicted.text : null).toBe('changed')

    const [kept] = decodeEventRows({ rows: [validRow(3, 'changed')], cache }).events
    expect(kept && 'text' in kept ? kept.text : null).toBe('x'.repeat(100))
  })

  it('counts the decoded size of a row against the cap, not its raw body bytes', () => {
    const body = JSON.stringify(said('x'.repeat(100)))
    const cache = new EventDecodeCache(body.length * 3)

    decodeEventRows({ rows: [rowAt({ seq: 1, body })], cache })
    decodeEventRows({ rows: [rowAt({ seq: 2, body })], cache })

    const [redecoded] = decodeEventRows({ rows: [validRow(1, 'changed')], cache }).events
    expect(redecoded && 'text' in redecoded ? redecoded.text : null).toBe('changed')
  })

  it('never retains a row whose decoded size alone exceeds the default cap', () => {
    const cache = new EventDecodeCache()
    const huge = rowAt({ seq: 1, body: JSON.stringify(said('x'.repeat(14 * 1024 * 1024))) })

    const first = decodeEventRows({ rows: [huge], cache })
    const second = decodeEventRows({ rows: [huge], cache })

    expect(second.events[0]).not.toBe(first.events[0])
  })
})
