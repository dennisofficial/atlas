import { describe, expect, it } from 'bun:test'

import {
  bucketOf,
  countThreads,
  EThreadBucket,
  hasThread,
  INACTIVE_AFTER_MS,
  mainThreadsOf,
  partitionThreads,
} from '../thread-partition'
import { agoIso, HOUR_MS, NOW, projectOf, sessionOf, threadOf } from './fixtures'

const idsOf = (list: { sessions: { mainThread: { id: string } }[] }[]) =>
  list.map((entry) => entry.sessions.map((session) => session.mainThread.id))

describe('bucketOf', () => {
  it('keeps a thread updated exactly 72h ago active', () => {
    const thread = threadOf({ id: 'a', updatedAt: agoIso(72) })
    expect(INACTIVE_AFTER_MS).toBe(72 * HOUR_MS)
    expect(bucketOf({ thread, now: NOW })).toBe(EThreadBucket.Active)
  })

  it('moves a thread updated one millisecond past 72h to inactive', () => {
    const thread = threadOf({
      id: 'a',
      updatedAt: new Date(NOW - INACTIVE_AFTER_MS - 1).toISOString(),
    })
    expect(bucketOf({ thread, now: NOW })).toBe(EThreadBucket.Inactive)
  })

  it('archives regardless of age and keeps archived out of inactive', () => {
    const thread = threadOf({ id: 'a', updatedAt: agoIso(500), archivedAt: agoIso(1) })
    expect(bucketOf({ thread, now: NOW })).toBe(EThreadBucket.Archived)
  })

  it('keeps an old pinned thread active', () => {
    const thread = threadOf({ id: 'a', updatedAt: agoIso(500), pinnedAt: agoIso(400) })
    expect(bucketOf({ thread, now: NOW })).toBe(EThreadBucket.Active)
  })

  it('treats null stamps as unset and an unparseable updatedAt as active', () => {
    expect(
      bucketOf({
        thread: threadOf({ id: 'a', updatedAt: agoIso(100), pinnedAt: null, archivedAt: null }),
        now: NOW,
      }),
    ).toBe(EThreadBucket.Inactive)
    expect(bucketOf({ thread: threadOf({ id: 'a', updatedAt: 'nope' }), now: NOW })).toBe(
      EThreadBucket.Active,
    )
  })
})

describe('partitionThreads', () => {
  const entries = [
    {
      project: projectOf('p1'),
      sessions: [
        sessionOf(threadOf({ id: 'old', updatedAt: agoIso(100) })),
        sessionOf(threadOf({ id: 'newer', createdAt: agoIso(3), updatedAt: agoIso(0.5) })),
        sessionOf(threadOf({ id: 'fresh', createdAt: agoIso(5), updatedAt: agoIso(1) })),
        sessionOf(threadOf({ id: 'pinned', updatedAt: agoIso(60), pinnedAt: agoIso(2) })),
        sessionOf(threadOf({ id: 'gone', updatedAt: agoIso(2), archivedAt: agoIso(1) })),
        sessionOf(threadOf({ id: 'gone-old', updatedAt: agoIso(200), archivedAt: agoIso(150) })),
      ],
    },
    {
      project: projectOf('p2'),
      sessions: [sessionOf(threadOf({ id: 'solo', updatedAt: agoIso(2) }))],
    },
    { project: projectOf('p3'), sessions: [] },
  ]

  const partition = partitionThreads({ entries, now: NOW })

  it('sorts pinned first, then oldest created first, ignoring activity', () => {
    expect(idsOf(partition.groups)).toEqual([['pinned', 'fresh', 'newer'], ['solo'], []])
  })

  it('keeps every project as a group, even with no active threads', () => {
    expect(partition.groups.map((group) => group.project.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('collects inactive and archived threads per project and drops empty projects', () => {
    expect(partition.inactive.map((entry) => entry.project.id)).toEqual(['p1'])
    expect(idsOf(partition.inactive)).toEqual([['old']])
    expect(partition.archived.map((entry) => entry.project.id)).toEqual(['p1'])
    expect(idsOf(partition.archived)).toEqual([['gone', 'gone-old']])
  })

  it('counts and finds threads across entries', () => {
    expect(countThreads(partition.inactive)).toBe(1)
    expect(countThreads(partition.archived)).toBe(2)
    expect(hasThread({ entries, threadId: 'solo' })).toBe(true)
    expect(hasThread({ entries, threadId: 'missing' })).toBe(false)
  })
})

describe('projectless threads', () => {
  it('shows a no-project group only when it holds active threads', () => {
    const loose = sessionOf(threadOf({ id: 'loose', updatedAt: agoIso(1) }))
    const stale = sessionOf(threadOf({ id: 'stale', updatedAt: agoIso(100) }))
    const shown = partitionThreads({
      entries: [
        { project: projectOf('p1'), sessions: [] },
        { project: null, sessions: [loose] },
      ],
      now: NOW,
    })
    expect(shown.groups.map((group) => group.project?.id ?? null)).toEqual(['p1', null])
    expect(idsOf(shown.groups)).toEqual([[], ['loose']])

    const hidden = partitionThreads({ entries: [{ project: null, sessions: [stale] }], now: NOW })
    expect(hidden.groups).toEqual([])
    expect(idsOf(hidden.inactive)).toEqual([['stale']])
  })
})

describe('teammates', () => {
  const teammate = sessionOf(threadOf({ id: 'mate', updatedAt: agoIso(1) }))
  const manager = sessionOf(threadOf({ id: 'boss', updatedAt: agoIso(100) }), [teammate])
  const entries = [{ project: projectOf('p1'), sessions: [manager] }]

  it('keeps a teammate in its manager bucket whatever its own age', () => {
    const partition = partitionThreads({ entries, now: NOW })
    expect(idsOf(partition.groups)).toEqual([[]])
    expect(idsOf(partition.inactive)).toEqual([['boss']])
    expect(partition.inactive[0]?.sessions[0]?.teammates).toEqual([teammate])
  })

  it('finds a teammate main thread as the active thread', () => {
    expect(hasThread({ entries, threadId: 'mate' })).toBe(true)
    expect(mainThreadsOf([manager]).map((thread) => thread.id)).toEqual(['boss', 'mate'])
  })
})
