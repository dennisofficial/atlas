import { describe, expect, it } from 'bun:test'

import { EPeerBucket, peerBucketOf, splitTeammates } from '../session-tree'
import { INACTIVE_AFTER_MS } from '../project-recency'

const NOW = Date.parse('2026-11-21T12:00:00.000Z')
const ago = (hours: number): string => new Date(NOW - hours * 3_600_000).toISOString()

describe('peerBucketOf', () => {
  it('keeps a row updated inside 72h active and moves one past it to inactive', () => {
    expect(peerBucketOf({ row: { updatedAt: ago(1) }, now: NOW })).toBe(EPeerBucket.Active)
    expect(
      peerBucketOf({
        row: { updatedAt: new Date(NOW - INACTIVE_AFTER_MS).toISOString() },
        now: NOW,
      }),
    ).toBe(EPeerBucket.Active)
    expect(
      peerBucketOf({
        row: { updatedAt: new Date(NOW - INACTIVE_AFTER_MS - 1).toISOString() },
        now: NOW,
      }),
    ).toBe(EPeerBucket.Inactive)
  })

  it('files an archived row in archived whatever its age or pin', () => {
    expect(
      peerBucketOf({ row: { updatedAt: ago(1), pinnedAt: ago(1), archivedAt: ago(1) }, now: NOW }),
    ).toBe(EPeerBucket.Archived)
    expect(peerBucketOf({ row: { updatedAt: ago(500), archivedAt: ago(500) }, now: NOW })).toBe(
      EPeerBucket.Archived,
    )
  })

  it('keeps a pinned row active ahead of the 72h rule', () => {
    expect(peerBucketOf({ row: { updatedAt: ago(500), pinnedAt: ago(400) }, now: NOW })).toBe(
      EPeerBucket.Active,
    )
  })

  it('treats an unparsable update stamp as active', () => {
    expect(peerBucketOf({ row: { updatedAt: 'nope' }, now: NOW })).toBe(EPeerBucket.Active)
  })
})

describe('splitTeammates', () => {
  it('moves only archived rows into done and keeps the input order', () => {
    const rows = [
      { sessionId: 'a', archivedAt: null },
      { sessionId: 'b', archivedAt: ago(1) },
      { sessionId: 'c' },
      { sessionId: 'd', archivedAt: ago(2) },
    ]
    const { active, done } = splitTeammates(rows)
    expect(active.map((row) => row.sessionId)).toEqual(['a', 'c'])
    expect(done.map((row) => row.sessionId)).toEqual(['b', 'd'])
  })
})
