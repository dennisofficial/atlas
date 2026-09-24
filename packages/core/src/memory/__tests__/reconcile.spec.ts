import { describe, expect, it } from 'bun:test'

import { MAX_INDEX_BYTES, MAX_INDEX_LINES } from '../index-file'
import { indexNearsBound, RECONCILE_THRESHOLD, reconcileNudgeText } from '../reconcile'

describe('indexNearsBound', () => {
  it('is false for a small index', () => {
    expect(indexNearsBound({ lines: 40, bytes: 4_000 })).toBe(false)
  })

  it('trips on lines alone', () => {
    expect(indexNearsBound({ lines: Math.ceil(MAX_INDEX_LINES * RECONCILE_THRESHOLD), bytes: 100 })).toBe(true)
  })

  it('trips on bytes alone', () => {
    expect(indexNearsBound({ lines: 5, bytes: Math.ceil(MAX_INDEX_BYTES * RECONCILE_THRESHOLD) })).toBe(true)
  })

  it('stays quiet just under the threshold', () => {
    expect(
      indexNearsBound({
        lines: Math.floor(MAX_INDEX_LINES * RECONCILE_THRESHOLD) - 1,
        bytes: Math.floor(MAX_INDEX_BYTES * RECONCILE_THRESHOLD) - 1,
      }),
    ).toBe(false)
  })
})

describe('reconcileNudgeText', () => {
  it('names the directory and both dimensions as percents', () => {
    const text = reconcileNudgeText({
      directory: '/home/dev/.atlas/memory',
      size: { lines: 170, bytes: 21_000 },
    })
    expect(text).toContain('/home/dev/.atlas/memory')
    expect(text).toContain('85%')
    expect(text).toContain('84%')
  })

  it('asks for a reconcile, not a trim', () => {
    const text = reconcileNudgeText({ directory: '/d', size: { lines: 170, bytes: 21_000 } })
    expect(text).toContain('Reconcile instead')
    expect(text).toContain('by shortening one entry')
    expect(text).toContain('Fold overlapping memories')
  })
})
