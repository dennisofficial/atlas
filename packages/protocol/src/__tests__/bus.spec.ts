import { describe, expect, it } from 'bun:test'

import { EStepEndReason } from '@dltech/atlas-core'

import {
  PG_CHANGE_CHANNEL,
  PG_HOST_CHANGE_CHANNEL,
  PG_PRESENCE_LOCK_NAMESPACE,
  PG_WAKE_CHANNEL,
  liveFrameSchema,
  type LiveFrame,
  sessionChangeSchema,
  sessionLiveBufferKey,
  sessionLiveChannel,
} from '../bus'
import { EStreamBlockKind } from '../stream-constants'

describe('bus names', () => {
  it('names the postgres wake channel', () => {
    expect(PG_WAKE_CHANNEL).toBe('atlas_session_wake')
  })

  it('names the host change channel', () => {
    expect(PG_HOST_CHANGE_CHANNEL).toBe('atlas_host_change')
  })

  it('namespaces presence locks with a fixed int4 key', () => {
    expect(PG_PRESENCE_LOCK_NAMESPACE).toBe(1095060563)
    expect(Number.isInteger(PG_PRESENCE_LOCK_NAMESPACE)).toBe(true)
    expect(PG_PRESENCE_LOCK_NAMESPACE).toBeLessThanOrEqual(2 ** 31 - 1)
  })

  it('names a per-session live channel', () => {
    expect(sessionLiveChannel('session-1')).toBe('atlas:session-live:session-1')
  })

  it('names the session change channel', () => {
    expect(PG_CHANGE_CHANNEL).toBe('atlas_session_changed')
  })

  it('parses a bare change and a full change', () => {
    expect(sessionChangeSchema.parse({ sessionId: 's' })).toEqual({ sessionId: 's' })
    expect(sessionChangeSchema.parse({ sessionId: 's', threadId: 't', headSeq: 0 })).toEqual({
      sessionId: 's',
      threadId: 't',
      headSeq: 0,
    })
  })

  it('rejects empty ids, negative or fractional heads and unknown keys', () => {
    expect(sessionChangeSchema.safeParse({ sessionId: '' }).success).toBe(false)
    expect(sessionChangeSchema.safeParse({ sessionId: 's', headSeq: -1 }).success).toBe(false)
    expect(sessionChangeSchema.safeParse({ sessionId: 's', headSeq: 1.5 }).success).toBe(false)
    expect(sessionChangeSchema.safeParse({ sessionId: 's', extra: 1 }).success).toBe(false)
  })

  it('keeps a worst-case payload far below the 8000 byte NOTIFY limit', () => {
    const id = 'x'.repeat(256)
    const payload = JSON.stringify({
      sessionId: id,
      threadId: id,
      headSeq: Number.MAX_SAFE_INTEGER,
    })
    expect(Buffer.byteLength(payload)).toBeLessThan(1_000)
  })

  it('names a per-session live buffer key', () => {
    expect(sessionLiveBufferKey('session-1')).toBe('atlas:session-live-buf:session-1')
  })
})

describe('step live frames', () => {
  const key = { runId: 'run-1', step: 3, attempt: 0 }

  it('parses step-start, delta and step-end', () => {
    expect(liveFrameSchema.parse({ type: 'step-start', key, afterSeq: 4 })).toEqual({
      type: 'step-start',
      key,
      afterSeq: 4,
    })
    const delta: LiveFrame = {
      type: 'delta',
      key,
      block: 'b1',
      kind: EStreamBlockKind.Reasoning,
      from: 4,
      text: 'hi',
    }
    expect(liveFrameSchema.parse(delta)).toEqual(delta)
    const end: LiveFrame = { type: 'step-end', key, reason: EStepEndReason.Aborted }
    expect(liveFrameSchema.parse(end)).toEqual(end)
  })

  it('rejects a bad kind, a bad reason, a negative offset, a bad key and unknown keys', () => {
    const delta = { type: 'delta', key, block: 'b1', kind: 'text', from: 0, text: '' }
    expect(liveFrameSchema.safeParse({ ...delta, kind: 'tool' }).success).toBe(false)
    expect(liveFrameSchema.safeParse({ ...delta, from: -1 }).success).toBe(false)
    expect(liveFrameSchema.safeParse({ ...delta, extra: 1 }).success).toBe(false)
    expect(liveFrameSchema.safeParse({ type: 'step-end', key, reason: 'done' }).success).toBe(false)
    expect(liveFrameSchema.safeParse({ type: 'step-start', key: { runId: 'r' } }).success).toBe(
      false,
    )
  })
})
