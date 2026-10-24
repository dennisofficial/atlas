import { describe, expect, it } from 'bun:test'
import { meta, metaOf } from './procedure-meta'

describe('metaOf', () => {
  it('returns the typed keys it was given', () => {
    const value = meta({ podReachable: true, throttle: { limit: 5, ttlMs: 1000 } })

    expect(metaOf(value)).toEqual({ podReachable: true, throttle: { limit: 5, ttlMs: 1000 } })
  })

  it('keeps throttle: false', () => {
    expect(metaOf({ throttle: false })).toEqual({ throttle: false })
  })

  it('answers an empty meta for absent or malformed input', () => {
    for (const raw of [
      undefined,
      null,
      'x',
      4,
      { podReachable: false },
      { throttle: { limit: 0 } },
    ]) {
      expect(metaOf(raw)).toEqual({})
    }
  })
})
