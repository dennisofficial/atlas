import { describe, expect, it } from 'bun:test'

import {
  EQualityReviewStatus,
  eventBodySchema,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type CodeQualityReviewedBody,
} from '@dltech/atlas-core'
import { CHANNEL_PROTOCOL_VERSION } from '@dltech/atlas-wire'

import { eventFromWire, wireDraftOf, type WireEvent } from '../session-wire'

const review: CodeQualityReviewedBody = {
  type: 'code-quality-reviewed',
  callId: toCallId('call-1'),
  workspaceNamespace: 'local:abc',
  path: 'src/a.ts',
  beforeHash: 'b1',
  afterHash: 'a1',
  status: EQualityReviewStatus.Completed,
  assessments: [],
  findings: [],
  durationMs: 12,
}

const wireEventOf = (draft: { type: string; body: string }): WireEvent => ({
  id: toEventId('event-1'),
  threadId: toThreadId('thread-1'),
  seq: 1,
  runId: toRunId('run-1'),
  depth: 0,
  at: '2026-10-06T00:00:00.000Z',
  ...draft,
})

describe('a matched session decodes code-quality-reviewed events', () => {
  it('retains the already compatible protocol version', () => {
    expect(CHANNEL_PROTOCOL_VERSION).toBe(19)
  })

  it('round-trips a quality review through the wire unchanged', () => {
    const decoded = eventFromWire(wireEventOf(wireDraftOf(review)))

    expect(decoded).toMatchObject({ ...review, seq: 1, threadId: toThreadId('thread-1') })
  })
})

describe('a client that predates the event body', () => {
  it('refuses a body type it does not know instead of guessing at it', () => {
    const body = JSON.stringify({ type: 'code-quality-reviewed-from-the-future', callId: 'call-1' })

    expect(eventBodySchema.safeParse(JSON.parse(body)).success).toBe(false)
    expect(() => eventFromWire(wireEventOf({ type: 'code-quality-reviewed-from-the-future', body }))).toThrow()
  })
})
