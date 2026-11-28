import { describe, expect, it } from 'bun:test'

import { EStreamCacheOutcome, EStreamSubscribeKind } from '../stream-constants'
import { streamClientMessageSchema } from '../stream-client'

const subscribe = {
  type: 'subscribe',
  id: 's1',
  kind: EStreamSubscribeKind.Session,
  sessionId: 'session-1',
}

describe('stream cache telemetry', () => {
  it.each(Object.values(EStreamCacheOutcome))('accepts the %s cache outcome', (cache) => {
    const input = { ...subscribe, cache, hydrateMs: 225 }
    expect(streamClientMessageSchema.parse(input)).toEqual(input)
  })

  it('keeps cache telemetry optional', () => {
    expect(streamClientMessageSchema.parse(subscribe)).toEqual(subscribe)
  })

  it.each([-1, 0.5, Number.POSITIVE_INFINITY])('rejects hydrateMs %s', (hydrateMs) => {
    expect(streamClientMessageSchema.safeParse({ ...subscribe, hydrateMs }).success).toBe(false)
  })

  it('rejects an unknown cache outcome', () => {
    expect(streamClientMessageSchema.safeParse({ ...subscribe, cache: 'unknown' }).success).toBe(
      false,
    )
  })
})
