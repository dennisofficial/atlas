import { describe, expect, it } from 'bun:test'

import { EPeerBucket, peerBucketOf, splitTeammates } from '../session-tree'

const NOW = Date.parse('2026-11-21T12:00:00.000Z')
const ago = (hours: number): string => new Date(NOW - hours * 3_600_000).toISOString()

describe('peerBucketOf', () => {
  it('keeps an unarchived row active whatever its age or pin', () => {
    expect(peerBucketOf({ row: { updatedAt: ago(1) } })).toBe(EPeerBucket.Active)
    expect(peerBucketOf({ row: { updatedAt: ago(500) } })).toBe(EPeerBucket.Active)
    expect(peerBucketOf({ row: { updatedAt: ago(500), pinnedAt: ago(400) } })).toBe(
      EPeerBucket.Active,
    )
  })

  it('files an archived row in archived whatever its age or pin', () => {
    expect(peerBucketOf({ row: { updatedAt: ago(1), pinnedAt: ago(1), archivedAt: ago(1) } })).toBe(
      EPeerBucket.Archived,
    )
    expect(peerBucketOf({ row: { updatedAt: ago(500), archivedAt: ago(500) } })).toBe(
      EPeerBucket.Archived,
    )
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
