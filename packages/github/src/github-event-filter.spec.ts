import { describe, expect, it } from 'bun:test'
import { wantsPrEvent } from './github-event-filter'

const delivers = (events: readonly string[], kind: string): boolean =>
  wantsPrEvent({ events, kind })

describe('wantsPrEvent', () => {
  it('delivers every kind to a row with no filter', () => {
    const kinds = [
      'comment',
      'review',
      'review-comment',
      'verdict',
      'mergeability',
      'state',
      'auto-merge-off',
    ]
    for (const kind of kinds) expect(delivers([], kind)).toBe(true)
  })

  it('delivers only state to a state-only filter, and state regardless of the filter', () => {
    expect(delivers(['state'], 'state')).toBe(true)
    expect(delivers(['state'], 'comment')).toBe(false)
    expect(delivers(['state'], 'verdict')).toBe(false)
    expect(delivers(['state'], 'mergeability')).toBe(false)
    expect(delivers(['comments'], 'state')).toBe(true)
    expect(delivers(['ci'], 'state')).toBe(true)
  })

  it('groups the discussion kinds under comments and the merge queue under mergeability', () => {
    for (const kind of ['comment', 'review', 'review-comment']) {
      expect(delivers(['comments'], kind)).toBe(true)
    }
    expect(delivers(['comments'], 'verdict')).toBe(false)
    expect(delivers(['ci'], 'verdict')).toBe(true)
    expect(delivers(['ci'], 'review')).toBe(false)
    expect(delivers(['mergeability'], 'merge-queue')).toBe(true)
    expect(delivers(['mergeability'], 'auto-merge-off')).toBe(true)
    expect(delivers(['mergeability'], 'mergeable')).toBe(false)
  })

  it('delivers every asked-for group when several are listed', () => {
    const events = ['comments', 'ci']
    expect(delivers(events, 'review')).toBe(true)
    expect(delivers(events, 'verdict')).toBe(true)
    expect(delivers(events, 'mergeability')).toBe(false)
  })
})
