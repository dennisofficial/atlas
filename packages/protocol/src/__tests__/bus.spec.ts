import { describe, expect, it } from 'bun:test'

import {
  PG_CHANGE_CHANNEL,
  PG_HOST_CHANGE_CHANNEL,
  PG_PRESENCE_LOCK_NAMESPACE,
  PG_WAKE_CHANNEL,
  sessionChangeSchema,
  sessionLiveChannel,
} from '../bus'

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
})
