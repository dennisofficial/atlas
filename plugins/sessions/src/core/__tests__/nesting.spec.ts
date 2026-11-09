import { describe, expect, it } from 'bun:test'

import { nestPeers } from '../../client'

const row = (args: {
  sessionId: string
  spawnedBy?: string | null
  archivedAt?: string | null
}) => ({
  sessionId: args.sessionId,
  spawnedBy: args.spawnedBy ?? null,
  archivedAt: args.archivedAt ?? null,
})

type Shape = { sessionId: string; children: readonly Shape[] }

const shapeOf = (nodes: readonly Shape[]): readonly Shape[] =>
  nodes.map((node) => ({ sessionId: node.sessionId, children: shapeOf(node.children) }))

describe('nestPeers', () => {
  it('nests a child under the session that spawned it', () => {
    const nested = nestPeers([
      row({ sessionId: 's1' }),
      row({ sessionId: 'p1', spawnedBy: 's1' }),
      row({ sessionId: 'p2', spawnedBy: 's1' }),
    ])
    expect(shapeOf(nested)).toEqual([
      {
        sessionId: 's1',
        children: [
          { sessionId: 'p1', children: [] },
          { sessionId: 'p2', children: [] },
        ],
      },
    ])
  })

  it('nests grandchildren recursively', () => {
    const nested = nestPeers([
      row({ sessionId: 's1' }),
      row({ sessionId: 'p1', spawnedBy: 's1' }),
      row({ sessionId: 'g1', spawnedBy: 'p1' }),
    ])
    expect(shapeOf(nested)).toEqual([
      {
        sessionId: 's1',
        children: [{ sessionId: 'p1', children: [{ sessionId: 'g1', children: [] }] }],
      },
    ])
  })

  it('keeps a child whose spawner is absent as a root', () => {
    const nested = nestPeers([
      row({ sessionId: 'p1', spawnedBy: 'gone' }),
      row({ sessionId: 's1' }),
    ])
    expect(shapeOf(nested)).toEqual([
      { sessionId: 'p1', children: [] },
      { sessionId: 's1', children: [] },
    ])
  })

  it('preserves input order among roots and among siblings', () => {
    const nested = nestPeers([
      row({ sessionId: 'b' }),
      row({ sessionId: 'p2', spawnedBy: 'a' }),
      row({ sessionId: 'a' }),
      row({ sessionId: 'p1', spawnedBy: 'a' }),
    ])
    expect(shapeOf(nested)).toEqual([
      { sessionId: 'b', children: [] },
      {
        sessionId: 'a',
        children: [
          { sessionId: 'p2', children: [] },
          { sessionId: 'p1', children: [] },
        ],
      },
    ])
  })

  it('carries the row through untouched', () => {
    const nested = nestPeers([row({ sessionId: 'p1', archivedAt: '2026-11-09T10:00:00.000Z' })])
    expect(nested[0]?.archivedAt).toBe('2026-11-09T10:00:00.000Z')
    expect(nested[0]?.spawnedBy).toBeNull()
  })

  it('treats an undefined spawner as a root', () => {
    expect(
      shapeOf(nestPeers([{ sessionId: 's1' }, { sessionId: 's2', spawnedBy: undefined }])),
    ).toEqual([
      { sessionId: 's1', children: [] },
      { sessionId: 's2', children: [] },
    ])
  })

  it('returns nothing for an empty list', () => {
    expect(nestPeers([])).toEqual([])
  })
})
