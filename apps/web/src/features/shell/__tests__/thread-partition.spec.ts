import { describe, expect, it } from 'bun:test'

import {
  bucketOf,
  countThreads,
  EThreadBucket,
  hasThread,
  mainThreadsOf,
  partitionThreads,
} from '../thread-partition'
import { agoIso, projectOf, sessionOf, threadOf } from './fixtures'

const idsOf = (list: { sessions: { mainThread: { id: string } }[] }[]) =>
  list.map((entry) => entry.sessions.map((session) => session.mainThread.id))

describe('bucketOf', () => {
  it('keeps a thread active whatever its age', () => {
    expect(bucketOf({ thread: threadOf({ id: 'a', updatedAt: agoIso(72) }) })).toBe(
      EThreadBucket.Active,
    )
    expect(bucketOf({ thread: threadOf({ id: 'a', updatedAt: agoIso(900) }) })).toBe(
      EThreadBucket.Active,
    )
  })

  it('archives regardless of age or pin', () => {
    const thread = threadOf({ id: 'a', updatedAt: agoIso(500), archivedAt: agoIso(1) })
    expect(bucketOf({ thread })).toBe(EThreadBucket.Archived)
    const pinned = threadOf({
      id: 'b',
      updatedAt: agoIso(1),
      pinnedAt: agoIso(1),
      archivedAt: agoIso(1),
    })
    expect(bucketOf({ thread: pinned })).toBe(EThreadBucket.Archived)
  })

  it('keeps an old pinned thread active', () => {
    const thread = threadOf({ id: 'a', updatedAt: agoIso(500), pinnedAt: agoIso(400) })
    expect(bucketOf({ thread })).toBe(EThreadBucket.Active)
  })

  it('treats null stamps as unset and an unparseable updatedAt as active', () => {
    expect(
      bucketOf({
        thread: threadOf({ id: 'a', updatedAt: agoIso(100), pinnedAt: null, archivedAt: null }),
      }),
    ).toBe(EThreadBucket.Active)
    expect(bucketOf({ thread: threadOf({ id: 'a', updatedAt: 'nope' }) })).toBe(
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

  const partition = partitionThreads({ entries })

  it('sorts pinned first, then oldest created first, ignoring activity', () => {
    expect(idsOf(partition.groups)).toEqual([['pinned', 'fresh', 'newer', 'old'], ['solo']])
  })

  it('keeps an old session in its project group', () => {
    expect(partition.groups[0]?.sessions.map((session) => session.id)).toContain('ses_old')
  })

  it('hides a project with no active threads', () => {
    expect(partition.groups.map((group) => group.project?.id)).toEqual(['p1', 'p2'])
  })

  it('collects archived threads per project and drops empty projects', () => {
    expect(partition.archived.map((entry) => entry.project.id)).toEqual(['p1'])
    expect(idsOf(partition.archived)).toEqual([['gone', 'gone-old']])
  })

  it('counts and finds threads across entries', () => {
    expect(countThreads(partition.archived)).toBe(2)
    expect(hasThread({ entries, threadId: 'solo' })).toBe(true)
    expect(hasThread({ entries, threadId: 'missing' })).toBe(false)
  })
})

describe('projectless threads', () => {
  it('shows a no-project group whatever the age of its threads', () => {
    const loose = sessionOf(threadOf({ id: 'loose', updatedAt: agoIso(1) }))
    const stale = sessionOf(threadOf({ id: 'stale', updatedAt: agoIso(100) }))
    const shown = partitionThreads({
      entries: [
        { project: projectOf('p1'), sessions: [] },
        { project: null, sessions: [loose, stale] },
      ],
    })
    expect(shown.groups.map((group) => group.project?.id ?? null)).toEqual([null])
    expect(idsOf(shown.groups)).toEqual([['loose', 'stale']])
  })
})

describe('project visibility', () => {
  const groupIdsOf = (entries: Parameters<typeof partitionThreads>[0]['entries']) =>
    partitionThreads({ entries }).groups.map((group) => group.project?.id)

  it('hides a project as soon as its only thread is archived', () => {
    const done = threadOf({ id: 'done', updatedAt: agoIso(0.2), archivedAt: agoIso(0.1) })
    expect(groupIdsOf([{ project: projectOf('p1'), sessions: [sessionOf(done)] }])).toEqual([])
  })

  it('keeps a project visible while it holds a thread idle for over 72h', () => {
    const stale = sessionOf(threadOf({ id: 'stale', updatedAt: agoIso(80) }))
    const partition = partitionThreads({
      entries: [{ project: projectOf('p1'), sessions: [stale] }],
    })
    expect(partition.groups.map((group) => group.project?.id)).toEqual(['p1'])
    expect(idsOf(partition.groups)).toEqual([['stale']])
  })

  it('hides a newly created project with no threads', () => {
    const fresh = { ...projectOf('p1'), createdAt: agoIso(0.1) }
    expect(groupIdsOf([{ project: fresh, sessions: [] }])).toEqual([])
  })

  it('keeps a project with an old pinned thread visible', () => {
    const pin = threadOf({ id: 'pin', updatedAt: agoIso(500), pinnedAt: agoIso(400) })
    expect(groupIdsOf([{ project: projectOf('p1'), sessions: [sessionOf(pin)] }])).toEqual(['p1'])
  })
})

describe('teammates', () => {
  const teammate = sessionOf(threadOf({ id: 'mate', updatedAt: agoIso(1) }))
  const manager = sessionOf(threadOf({ id: 'boss', updatedAt: agoIso(100) }), [teammate])
  const entries = [{ project: projectOf('p1'), sessions: [manager] }]

  it('keeps a teammate in its manager bucket whatever its own age', () => {
    const partition = partitionThreads({ entries })
    expect(idsOf(partition.groups)).toEqual([['boss']])
    expect(partition.groups[0]?.sessions[0]?.teammates).toEqual([teammate])
  })

  it('finds a teammate main thread as the active thread', () => {
    expect(hasThread({ entries, threadId: 'mate' })).toBe(true)
    expect(mainThreadsOf([manager]).map((thread) => thread.id)).toEqual(['boss', 'mate'])
  })
})
