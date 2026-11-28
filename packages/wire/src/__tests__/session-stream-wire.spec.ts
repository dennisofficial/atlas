import { describe, expect, it } from 'bun:test'
import { EStreamCacheOutcome } from '@dltech/atlas-protocol'

import { sessionStreamFollowInputSchema } from '../session-stream-wire'

const follow = { sessionId: 'session-1' }

describe('session stream follow telemetry', () => {
  it.each(Object.values(EStreamCacheOutcome))('accepts the %s cache outcome', (cache) => {
    const input = { ...follow, cache, hydrateMs: 225 }
    expect(sessionStreamFollowInputSchema.parse(input)).toEqual(input)
  })

  it('accepts older clients without cache telemetry', () => {
    expect(sessionStreamFollowInputSchema.parse(follow)).toEqual(follow)
  })

  it.each([-1, 0.5, Number.POSITIVE_INFINITY])('rejects hydrateMs %s', (hydrateMs) => {
    expect(sessionStreamFollowInputSchema.safeParse({ ...follow, hydrateMs }).success).toBe(false)
  })

  it('rejects an unknown cache outcome', () => {
    expect(sessionStreamFollowInputSchema.safeParse({ ...follow, cache: 'unknown' }).success).toBe(
      false,
    )
  })
})
