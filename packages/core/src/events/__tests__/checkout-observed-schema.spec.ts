import { describe, expect, it } from 'bun:test'

import { type EventDraft, survivesSummary } from '../body'
import { ERewindDisposition, rewindDisposition } from '../rewind-disposition'
import { eventBodySchema } from '../schema'

const observations: EventDraft[] = [
  { type: 'checkout-observed', path: '/work/repo', branch: 'main', detached: false },
  { type: 'checkout-observed', path: '/work/repo', branch: null, detached: true },
  { type: 'checkout-observed', path: '/tmp/plain', branch: null, detached: false },
]

describe('checkout-observed', () => {
  it('round-trips a branch, a detached HEAD and a directory outside git', () => {
    for (const body of observations) expect(eventBodySchema.parse(body)).toEqual(body)
  })

  it('rejects an empty branch name and a missing path', () => {
    expect(
      eventBodySchema.safeParse({
        type: 'checkout-observed',
        path: '/r',
        branch: '',
        detached: false,
      }).success,
    ).toBe(false)
    expect(
      eventBodySchema.safeParse({ type: 'checkout-observed', branch: 'main', detached: false })
        .success,
    ).toBe(false)
  })

  it('survives compaction and rewind, since git state outlives the conversation', () => {
    expect(survivesSummary('checkout-observed')).toBe(true)
    expect(rewindDisposition('checkout-observed')).toBe(ERewindDisposition.Keep)
  })
})
