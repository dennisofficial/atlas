import { describe, expect, it } from 'bun:test'

import { eventsFromWire } from '@dltech/atlas-client/transcript'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { durableTranscriptOf, ETranscriptKind, transcriptViewOf } from '../transcript-items'

const wire = (seq: number, body: Record<string, unknown>): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: `2026-10-22T10:00:${String(seq).padStart(2, '0')}.000Z`,
  type: String(body.type),
  body: JSON.stringify(body),
})

describe('a summary drawn at its target', () => {
  it('keeps a later report below the summary it came after', () => {
    const events = eventsFromWire([
      wire(1, { type: 'user-said', text: 'first' }),
      wire(2, { type: 'assistant-said', parts: [{ type: 'text', text: 'one' }] }),
      wire(3, { type: 'user-said', text: 'second' }),
      wire(4, {
        type: 'agent-reported',
        agentId: 'thr_teammate',
        agentType: 'teammate',
        intent: 'audit',
        prose: 'Halfway there',
        kind: 'progress',
      }),
      wire(5, {
        type: 'history-compacted',
        anchor: 'prefix',
        fromSeq: 1,
        throughSeq: 2,
        summary: 'the first exchange',
        replaced: 2,
      }),
    ])

    const rows = transcriptViewOf({ durable: durableTranscriptOf({ events }), live: [] }).items

    expect(rows.map((row) => row.id)).toEqual([
      'evt_1',
      'evt_2#0',
      'evt_5',
      'evt_3',
      expect.stringContaining('evt_4'),
    ])
    expect(rows[2]?.kind).toBe(ETranscriptKind.Notice)
  })
})
