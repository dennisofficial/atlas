import { describe, expect, it } from 'bun:test'

import type {
  SessionBucketPageInput,
  SessionBucketPageOutput,
  SessionSummary,
} from '@dltech/atlas-protocol'
import {
  ESessionBucket,
  type LiveThreadRow,
  type SessionPageInput,
  type SessionPageOutput,
} from '@dltech/atlas-wire/web'

import { createSessionPager, type SessionPageSnapshot } from '../session-pager'

import { agoIso, threadOf } from './fixtures'

const v1RowOf = (id: string, hours: number): LiveThreadRow => ({
  sessionId: `ses_${id}`,
  projectId: null,
  managedBySessionId: null,
  sortAt: agoIso(hours),
  rev: 1,
  thread: threadOf({ id, title: id, updatedAt: agoIso(hours) }),
})

const v2SummaryOf = (id: string, hours: number): SessionSummary => ({
  sessionId: `s_${id}`,
  projectId: null,
  title: `v2 ${id}`,
  naming: false,
  mainThreadId: `t_${id}`,
  createdAt: agoIso(hours + 1),
  updatedAt: agoIso(hours),
  archivedAt: null,
  model: { ref: 'claude', effort: 'medium', fast: false },
})

const v1PageOf = (args: {
  rows: LiveThreadRow[]
  archived: number
  next?: string
}): SessionPageOutput => ({
  rows: args.rows,
  counts: { active: 0, inactive: 0, archived: args.archived },
  ...(args.next === undefined ? {} : { next: args.next }),
})

const v2PageOf = (args: {
  sessions: SessionSummary[]
  archived: number
  next?: string
}): SessionBucketPageOutput => ({
  sessions: args.sessions,
  counts: { inactive: 0, archived: args.archived },
  ...(args.next === undefined ? {} : { next: args.next }),
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function recorder(pages: {
  v1: readonly SessionPageOutput[]
  v2: readonly SessionBucketPageOutput[]
}) {
  const v1Calls: SessionPageInput[] = []
  const v2Calls: SessionBucketPageInput[] = []
  const snapshots: SessionPageSnapshot[] = []
  const loadV1 = async (input: SessionPageInput): Promise<SessionPageOutput> => {
    v1Calls.push(input)
    const page = pages.v1[v1Calls.length - 1]
    if (page === undefined) throw new Error(`unexpected v1 page ${v1Calls.length}`)
    return page
  }
  const loadV2 = async (input: SessionBucketPageInput): Promise<SessionBucketPageOutput> => {
    v2Calls.push(input)
    const page = pages.v2[v2Calls.length - 1]
    if (page === undefined) throw new Error(`unexpected v2 page ${v2Calls.length}`)
    return page
  }
  return { v1Calls, v2Calls, snapshots, loadV1, loadV2 }
}

const pagerOf = (recorded: ReturnType<typeof recorder>, bucket: ESessionBucket) =>
  createSessionPager({
    bucket,
    loadV1: recorded.loadV1,
    loadV2: recorded.loadV2,
    emit: (snapshot) => recorded.snapshots.push(snapshot),
  })

describe('createSessionPager', () => {
  it('merges the v1 and v2 rows by their last activity and sums both totals', async () => {
    const recorded = recorder({
      v1: [v1PageOf({ rows: [v1RowOf('alpha', 5), v1RowOf('charlie', 1)], archived: 2 })],
      v2: [v2PageOf({ sessions: [v2SummaryOf('bravo', 3)], archived: 1 })],
    })
    const pager = pagerOf(recorded, ESessionBucket.Archived)
    pager.start()
    await flush()

    expect(recorded.v1Calls).toEqual([{ bucket: ESessionBucket.Archived, limit: 20 }])
    expect(recorded.v2Calls).toEqual([{ bucket: 'archived', limit: 20 }])
    const latest = pager.snapshot()
    expect(latest.rows.map((row) => row.id)).toEqual(['charlie', 's_bravo', 'alpha'])
    expect(latest.total).toBe(3)
    expect(latest.next).toBe(false)
    expect(latest.loading).toBe(false)
  })

  it('links a v2 row to its session page and a v1 row to its thread', async () => {
    const recorded = recorder({
      v1: [v1PageOf({ rows: [v1RowOf('alpha', 5)], archived: 1 })],
      v2: [v2PageOf({ sessions: [v2SummaryOf('bravo', 3)], archived: 1 })],
    })
    const pager = pagerOf(recorded, ESessionBucket.Archived)
    pager.start()
    await flush()

    const hrefs = Object.fromEntries(pager.snapshot().rows.map((row) => [row.id, row.href]))
    expect(hrefs).toEqual({ alpha: '/threads/alpha', s_bravo: '/sessions/s_bravo' })
  })

  it('loads the next page of each source and stops when both run out', async () => {
    const recorded = recorder({
      v1: [
        v1PageOf({ rows: [v1RowOf('alpha', 5)], archived: 2, next: 'v1-cursor' }),
        v1PageOf({ rows: [v1RowOf('delta', 4)], archived: 2 }),
      ],
      v2: [
        v2PageOf({ sessions: [v2SummaryOf('bravo', 3)], archived: 2, next: 'v2-cursor' }),
        v2PageOf({ sessions: [v2SummaryOf('echo', 2)], archived: 2 }),
      ],
    })
    const pager = pagerOf(recorded, ESessionBucket.Archived)
    pager.start()
    await flush()
    pager.more()
    await flush()
    pager.more()
    await flush()

    expect(recorded.v1Calls).toEqual([
      { bucket: ESessionBucket.Archived, limit: 20 },
      { bucket: ESessionBucket.Archived, limit: 20, cursor: 'v1-cursor' },
    ])
    expect(recorded.v2Calls).toEqual([
      { bucket: 'archived', limit: 20 },
      { bucket: 'archived', limit: 20, cursor: 'v2-cursor' },
    ])
    const latest = pager.snapshot()
    expect(latest.rows.map((row) => row.id)).toEqual(['s_echo', 's_bravo', 'delta', 'alpha'])
    expect(latest.next).toBe(false)
  })

  it('keeps the rows of the source that loaded when the other one fails', async () => {
    const recorded = recorder({
      v1: [],
      v2: [v2PageOf({ sessions: [v2SummaryOf('bravo', 3)], archived: 1 })],
    })
    const pager = pagerOf(recorded, ESessionBucket.Archived)
    pager.start()
    await flush()

    const latest = pager.snapshot()
    expect(latest.rows.map((row) => row.id)).toEqual(['s_bravo'])
    expect(latest.total).toBeNull()
    expect(latest.error).toBe('unexpected v1 page 1')
  })

  it('sends the trimmed search term to both sources and resets paging', async () => {
    const recorded = recorder({
      v1: [
        v1PageOf({ rows: [v1RowOf('alpha', 5)], archived: 2, next: 'v1-cursor' }),
        v1PageOf({ rows: [v1RowOf('found', 1)], archived: 1 }),
      ],
      v2: [
        v2PageOf({ sessions: [v2SummaryOf('bravo', 3)], archived: 1, next: 'v2-cursor' }),
        v2PageOf({ sessions: [], archived: 0 }),
      ],
    })
    const pager = pagerOf(recorded, ESessionBucket.Archived)
    pager.start()
    await flush()
    pager.search('  found  ')
    await flush()

    expect(recorded.v1Calls.at(-1)).toEqual({
      bucket: ESessionBucket.Archived,
      limit: 20,
      search: 'found',
    })
    expect(recorded.v2Calls.at(-1)).toEqual({ bucket: 'archived', limit: 20, search: 'found' })
    const latest = pager.snapshot()
    expect(latest.search).toBe('found')
    expect(latest.rows.map((row) => row.id)).toEqual(['found'])
    expect(latest.next).toBe(false)
  })
})
