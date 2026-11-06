import { describe, expect, it } from 'bun:test'

import type { FollowedSessionList } from '@dltech/atlas-client/stream'

import type { V2SessionSummary } from '../v2-rows'
import { createSessionsFeed } from '../v2-sessions-feed'

const rowOf = (sessionId: string): V2SessionSummary => ({
  sessionId,
  projectId: 'p1',
  title: null,
  naming: true,
  mainThreadId: 'thr',
  createdAt: '2026-11-05T10:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  archivedAt: null,
})

const fakeList = () => {
  let rows: readonly V2SessionSummary[] | undefined
  const listeners = new Set<() => void>()
  const state = { closed: 0 }
  const list: FollowedSessionList = {
    getSnapshot: () => rows,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close: () => void (state.closed += 1),
  }
  const push = (next: readonly V2SessionSummary[]) => {
    rows = next
    for (const listener of listeners) listener()
  }
  return { list, push, state, listeners }
}

describe('sessions feed', () => {
  it('writes nothing before the first snapshot and every change after', () => {
    const fake = fakeList()
    const written: (readonly V2SessionSummary[])[] = []
    const feed = createSessionsFeed({
      follow: () => fake.list,
      write: (rows) => written.push(rows),
    })
    feed.retain()
    expect(written).toEqual([])
    fake.push([rowOf('a')])
    fake.push([rowOf('a'), rowOf('b')])
    expect(written.map((rows) => rows.length)).toEqual([1, 2])
  })

  it('shares one follow across holders and closes after the last release', () => {
    const fake = fakeList()
    let follows = 0
    const feed = createSessionsFeed({
      follow: () => {
        follows += 1
        return fake.list
      },
      write: () => undefined,
    })
    const releaseFirst = feed.retain()
    const releaseSecond = feed.retain()
    expect(follows).toBe(1)
    releaseFirst()
    releaseFirst()
    expect(fake.state.closed).toBe(0)
    releaseSecond()
    expect(fake.state.closed).toBe(1)
    expect(fake.listeners.size).toBe(0)
  })

  it('writes an already-known snapshot when a holder arrives late and follows again after a full release', () => {
    const fake = fakeList()
    fake.push([rowOf('a')])
    const written: (readonly V2SessionSummary[])[] = []
    const feed = createSessionsFeed({
      follow: () => fake.list,
      write: (rows) => written.push(rows),
    })
    feed.retain()()
    feed.retain()
    expect(written).toHaveLength(2)
    expect(fake.state.closed).toBe(1)
  })
})
