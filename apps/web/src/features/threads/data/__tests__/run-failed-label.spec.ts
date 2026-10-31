import { describe, expect, it } from 'bun:test'

import { eventsFromWire } from '../events-from-wire'
import { durableTranscriptOf, transcriptViewOf } from '../transcript-items'
import { runFailedLabelOf } from '../run-failed-label'
import { runAttentionOf } from '@dltech/atlas-client/transcript'
import type { WireEvent } from '@dltech/atlas-wire/web'

const wire = (seq: number, at: string, body: Record<string, unknown>): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: `2026-10-30T10:00:${at}.000Z`,
  type: String(body.type),
  body: JSON.stringify(body),
})

const said = wire(1, '00', { type: 'user-said', text: 'hi' })
const failed = wire(2, '01', {
  type: 'run-failed',
  failure: { kind: 'auth', message: 'bad key', providerId: 'inference' },
})
const dismissed = wire(3, '02', { type: 'run-failure-dismissed', failureSeq: 2 })

const attentionOf = (rows: WireEvent[]) =>
  runAttentionOf({
    events: eventsFromWire(rows),
    live: [],
    working: false,
    turnInFlight: false,
    channelReady: true,
  })

describe('runFailedLabelOf', () => {
  it('names the elapsed time since the operator spoke', () => {
    const events = eventsFromWire([said, wire(2, '12', JSON.parse(failed.body))])
    expect(runFailedLabelOf({ events, failureSeq: 2 })).toBe('run failed after 12s')
  })

  it('is plain under a second or without a failure seq', () => {
    const events = eventsFromWire([said, failed])
    expect(runFailedLabelOf({ events, failureSeq: 2 })).toBe('run failed after 1s')
    expect(runFailedLabelOf({ events, failureSeq: null })).toBe('run failed')
  })
})

describe('transcript with a failed run', () => {
  it('keeps the failure out of the rows; the marker comes from attention', () => {
    const durable = durableTranscriptOf({ events: eventsFromWire([said, failed]) })

    expect(transcriptViewOf({ durable, live: [] }).items).toHaveLength(1)
    expect(attentionOf([said, failed])?.failureSeq).toBe(2)
  })

  it('keeps no failure after a durable dismissal, from events alone', () => {
    const attention = attentionOf([said, failed, dismissed])

    expect(attention?.failure ?? null).toBeNull()
    expect(attention?.dismissible ?? false).toBe(false)
  })
})
