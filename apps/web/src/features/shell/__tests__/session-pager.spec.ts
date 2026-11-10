import { describe, expect, it } from 'bun:test'

import {
  ESessionBucket,
  type LiveThreadRow,
  type SessionPageInput,
  type SessionPageOutput,
} from '@dltech/atlas-wire/web'

import { createSessionPager, type SessionPageSnapshot } from '../session-pager'

import { agoIso, threadOf } from './fixtures'

const rowOf = (id: string): LiveThreadRow => ({
  sessionId: `ses_${id}`,
  projectId: null,
  managedBySessionId: null,
  sortAt: agoIso(100),
  rev: 1,
  thread: threadOf({ id, title: id }),
})

const pageOf = (args: {
  ids: readonly string[]
  archived: number
  next?: string
}): SessionPageOutput => ({
  rows: args.ids.map(rowOf),
  counts: { active: 4, inactive: 9, archived: args.archived },
  ...(args.next === undefined ? {} : { next: args.next }),
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function recorder(pages: readonly SessionPageOutput[]) {
  const calls: SessionPageInput[] = []
  const snapshots: SessionPageSnapshot[] = []
  const load = async (input: SessionPageInput): Promise<SessionPageOutput> => {
    calls.push(input)
    const page = pages[calls.length - 1]
    if (page === undefined) throw new Error(`unexpected page ${calls.length}`)
    return page
  }
  return { calls, snapshots, load }
}

describe('createSessionPager', () => {
  it('loads the first page with the bucket and limit, then keeps the counts', async () => {
    const recorded = recorder([pageOf({ ids: ['a', 'b'], archived: 488, next: 'cursor-1' })])
    const pager = createSessionPager({
      bucket: ESessionBucket.Archived,
      load: recorded.load,
      emit: (snapshot) => recorded.snapshots.push(snapshot),
    })
    pager.start()
    await flush()
    expect(recorded.calls).toEqual([{ bucket: ESessionBucket.Archived, limit: 20 }])
    const latest = pager.snapshot()
    expect(latest.rows.map((row) => row.thread.id)).toEqual(['a', 'b'])
    expect(latest.counts).toEqual({ active: 4, inactive: 9, archived: 488 })
    expect(latest.next).toBe('cursor-1')
    expect(latest.loading).toBe(false)
  })

  it('pages with the cursor until next is undefined and then stops asking', async () => {
    const recorded = recorder([
      pageOf({ ids: ['a'], archived: 3, next: 'cursor-1' }),
      pageOf({ ids: ['b'], archived: 3, next: 'cursor-2' }),
      pageOf({ ids: ['c'], archived: 3 }),
    ])
    const pager = createSessionPager({
      bucket: ESessionBucket.Archived,
      load: recorded.load,
      emit: (snapshot) => recorded.snapshots.push(snapshot),
    })
    pager.start()
    await flush()
    pager.more()
    await flush()
    pager.more()
    await flush()
    pager.more()
    await flush()
    expect(recorded.calls).toEqual([
      { bucket: ESessionBucket.Archived, limit: 20 },
      { bucket: ESessionBucket.Archived, limit: 20, cursor: 'cursor-1' },
      { bucket: ESessionBucket.Archived, limit: 20, cursor: 'cursor-2' },
    ])
    const latest = pager.snapshot()
    expect(latest.rows.map((row) => row.thread.id)).toEqual(['a', 'b', 'c'])
    expect(latest.next).toBeNull()
  })

  it('sends the trimmed search term and resets paging', async () => {
    const recorded = recorder([
      pageOf({ ids: ['a'], archived: 3, next: 'cursor-1' }),
      pageOf({ ids: ['b'], archived: 1, next: 'cursor-2' }),
      pageOf({ ids: ['named'], archived: 1 }),
    ])
    const pager = createSessionPager({
      bucket: ESessionBucket.Inactive,
      load: recorded.load,
      emit: (snapshot) => recorded.snapshots.push(snapshot),
    })
    pager.start()
    await flush()
    pager.more()
    await flush()
    expect(pager.snapshot().rows).toHaveLength(2)
    pager.search('  named  ')
    await flush()
    expect(recorded.calls.at(-1)).toEqual({
      bucket: ESessionBucket.Inactive,
      limit: 20,
      search: 'named',
    })
    const latest = pager.snapshot()
    expect(latest.search).toBe('named')
    expect(latest.rows.map((row) => row.thread.id)).toEqual(['named'])
    expect(latest.counts?.archived).toBe(1)
    expect(latest.next).toBeNull()
  })

  it('ignores a repeated search term', async () => {
    const recorded = recorder([pageOf({ ids: ['a'], archived: 1 })])
    const pager = createSessionPager({
      bucket: ESessionBucket.Archived,
      load: recorded.load,
      emit: (snapshot) => recorded.snapshots.push(snapshot),
    })
    pager.start()
    await flush()
    pager.search('')
    await flush()
    expect(recorded.calls).toHaveLength(1)
  })
})
