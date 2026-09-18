import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toThreadId, type ThreadId } from '@dltech/atlas-core'

import type { ThreadSummary } from '../../store/thread-store'
import { mergedThreadListing } from '../merged-thread-listing'

const PROJECT = '/repo'

const row = (
  id: string,
  updatedAt: string,
  location?: EExecutionLocation,
): ThreadSummary => ({
  id: toThreadId(id),
  head: 3,
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt,
  workspace: PROJECT,
  repo: null,
  ...(location === undefined ? {} : { executionLocation: location }),
})

const reads = (rows: readonly ThreadSummary[], fail = false) => ({
  list: async (): Promise<readonly ThreadSummary[]> => {
    if (fail) throw new Error('the cloud is unreachable')
    return rows
  },
  find: async (args: { threadId: ThreadId }): Promise<ThreadSummary | undefined> => {
    if (fail) throw new Error('the cloud is unreachable')
    return rows.find((row) => row.id === args.threadId)
  },
})

describe('listing threads across host and cloud', () => {
  it('unions both stores, reading the location off the row rather than the store it came from', async () => {
    const listing = mergedThreadListing({
      local: reads([row('thr_local', '2026-09-16T10:00:00.000Z')]),
      remote: reads([
        row('thr_cloud', '2026-09-16T11:00:00.000Z', EExecutionLocation.Cloud),
        row('thr_rolled_back', '2026-09-16T09:00:00.000Z', EExecutionLocation.Host),
      ]),
    })

    const rows = await listing.list({ project: PROJECT })

    expect(rows.map((row) => row.id)).toEqual([
      toThreadId('thr_cloud'),
      toThreadId('thr_local'),
      toThreadId('thr_rolled_back'),
    ])
    expect(rows[0]?.executionLocation).toBe(EExecutionLocation.Cloud)
    expect(rows[1]?.executionLocation).toBeUndefined()
    expect(rows[2]?.executionLocation).toBe(EExecutionLocation.Host)
  })

  it('trusts the location the cloud row carries, so a thread moved back reads as host', async () => {
    const listing = mergedThreadListing({
      local: reads([row('thr_back', '2026-09-16T10:00:00.000Z', EExecutionLocation.Cloud)]),
      remote: reads([row('thr_back', '2026-09-16T12:00:00.000Z', EExecutionLocation.Host)]),
    })

    const rows = await listing.list({ project: PROJECT })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.executionLocation).toBe(EExecutionLocation.Host)
  })

  it('shows a thread known to both once, as the cloud row', async () => {
    const listing = mergedThreadListing({
      local: reads([row('thr_same', '2026-09-16T10:00:00.000Z', EExecutionLocation.Cloud)]),
      remote: reads([
        { ...row('thr_same', '2026-09-16T12:00:00.000Z', EExecutionLocation.Cloud), title: 'lifted' },
      ]),
    })

    const rows = await listing.list({ project: PROJECT })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('lifted')
    expect(rows[0]?.executionLocation).toBe(EExecutionLocation.Cloud)
  })

  it('orders by recency across the union and honors the limit', async () => {
    const listing = mergedThreadListing({
      local: reads([row('thr_a', '2026-09-16T10:00:00.000Z'), row('thr_b', '2026-09-16T08:00:00.000Z')]),
      remote: reads([row('thr_c', '2026-09-16T09:00:00.000Z')]),
    })

    const rows = await listing.list({ project: PROJECT, limit: 2 })

    expect(rows.map((row) => row.id)).toEqual([toThreadId('thr_a'), toThreadId('thr_c')])
  })

  it('finds a cloud thread it is asked for, and a host thread the cloud never heard of', async () => {
    const listing = mergedThreadListing({
      local: reads([row('thr_local', '2026-09-16T10:00:00.000Z')]),
      remote: reads([row('thr_cloud', '2026-09-16T11:00:00.000Z', EExecutionLocation.Cloud)]),
    })

    const cloud = await listing.find({ threadId: toThreadId('thr_cloud') })
    const host = await listing.find({ threadId: toThreadId('thr_local') })

    expect(cloud?.executionLocation).toBe(EExecutionLocation.Cloud)
    expect(host?.executionLocation).toBeUndefined()
  })

  it('still lists the local threads when the cloud cannot be reached', async () => {
    const listing = mergedThreadListing({
      local: reads([row('thr_local', '2026-09-16T10:00:00.000Z')]),
      remote: reads([], true),
    })

    const rows = await listing.list({ project: PROJECT })

    expect(rows.map((row) => row.id)).toEqual([toThreadId('thr_local')])
  })
})
