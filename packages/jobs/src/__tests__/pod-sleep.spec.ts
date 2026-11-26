import { describe, expect, it } from 'bun:test'

import { podSleepIdempotencyKey, podSleepPayloadSchema } from '../pod-sleep'

describe('podSleepIdempotencyKey', () => {
  it('keys every stop by the park it serves, so a second press gets its own run', () => {
    const first = { sessionId: 'ses-1', epoch: 3, parkedAt: '2026-11-26T10:00:00.000Z' }
    const second = { ...first, parkedAt: '2026-11-26T10:00:01.000Z' }

    expect(podSleepIdempotencyKey(first)).toBe('pod-sleep:ses-1:2026-11-26T10:00:00.000Z')
    expect(podSleepIdempotencyKey(second)).not.toBe(podSleepIdempotencyKey(first))
  })

  it('keys an archived park by its epoch, since no park record was written', () => {
    expect(podSleepIdempotencyKey({ sessionId: 'ses-1', epoch: 3 })).toBe(
      'pod-sleep:ses-1:archived-3',
    )
  })
})

describe('podSleepPayloadSchema', () => {
  it('carries the park a stop wrote', () => {
    const payload = { sessionId: 'ses-1', epoch: 3, parkedAt: '2026-11-26T10:00:00.000Z' }

    expect(podSleepPayloadSchema.parse(payload)).toEqual(payload)
  })

  it('accepts an archived park, which has no parkedAt', () => {
    expect(podSleepPayloadSchema.parse({ sessionId: 'ses-1', epoch: 3 })).toEqual({
      sessionId: 'ses-1',
      epoch: 3,
    })
  })
})
