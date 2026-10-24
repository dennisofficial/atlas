import { describe, expect, it } from 'bun:test'

import {
  bucketOf,
  countThreads,
  EThreadBucket,
  hasThread,
  INACTIVE_AFTER_MS,
  partitionThreads,
} from '../thread-partition'
import { agoIso, HOUR_MS, NOW, projectOf, threadOf } from './fixtures'

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
      threads: [
        threadOf({ id: 'old', updatedAt: agoIso(100) }),
        threadOf({ id: 'fresh', updatedAt: agoIso(1) }),
        threadOf({ id: 'newer', updatedAt: agoIso(0.5) }),
        threadOf({ id: 'pinned', updatedAt: agoIso(60), pinnedAt: agoIso(2) }),
        threadOf({ id: 'gone', updatedAt: agoIso(2), archivedAt: agoIso(1) }),
        threadOf({ id: 'gone-old', updatedAt: agoIso(200), archivedAt: agoIso(150) }),
      ],
    },
    { project: projectOf('p2'), threads: [threadOf({ id: 'solo', updatedAt: agoIso(2) })] },
    { project: projectOf('p3'), threads: [] },
  ]

  const partition = partitionThreads({ entries, now: NOW })
  const idsOf = (list: { threads: { id: string }[] }[]) =>
    list.map((entry) => entry.threads.map((thread) => thread.id))

  it('sorts pinned first, then most recently updated, within each group', () => {
    expect(idsOf(partition.groups)).toEqual([['pinned', 'newer', 'fresh'], ['solo'], []])
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
