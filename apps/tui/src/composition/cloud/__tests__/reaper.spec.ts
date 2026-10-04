import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toThreadId, type ThreadId } from '@dltech/atlas-core'
import { ECloudSandboxState, type WireSandboxListEntry } from '@dltech/atlas-harness'

import {
  reapExpiredCloudSandboxes,
  REAPER_LIST_FAILURE_NOTICE_MS,
  SANDBOX_TTL_MS,
  type ReapedThread,
  type ReaperListFailureMark,
} from '../reaper'

const NOW = Date.parse('2026-09-26T00:00:00.000Z')

const rowOf = (args: { threadId: string; lastActivityAt: string }): WireSandboxListEntry => ({
  threadId: args.threadId,
  name: `atlas-sandbox-${args.threadId}`,
  driveName: `atlas-drive-${args.threadId}`,
  state: ECloudSandboxState.Parked,
  lastActivityAt: args.lastActivityAt,
})

const EXPIRED = rowOf({
  threadId: 'brn_expired',
  lastActivityAt: new Date(NOW - SANDBOX_TTL_MS - 1_000).toISOString(),
})
const FRESH = rowOf({
  threadId: 'brn_fresh',
  lastActivityAt: new Date(NOW - 60_000).toISOString(),
})

type Fixture = {
  rows: WireSandboxListEntry[]
  threads: Map<string, ReapedThread>
  calls: { kind: string; threadId: string }[]
  notices: string[]
  failDriveOn?: string[]
  failListWith?: unknown
  mark?: ReaperListFailureMark | null
  clears?: number
}

const fixture = (given: Partial<Fixture>) => {
  const held: Fixture = {
    rows: [],
    threads: new Map(),
    calls: [],
    notices: [],
    mark: null,
    clears: 0,
    ...given,
  }
  const record = (kind: string, threadId: string): void => {
    held.calls.push({ kind, threadId })
  }
  return {
    ...held,
    held,
    run: () =>
      reapExpiredCloudSandboxes({
        listSandboxes: async () => {
          if (held.failListWith !== undefined) throw held.failListWith
          return held.rows
        },
        destroyDrive: async ({ name, threadId }) => {
          record(`drive:${name}`, threadId)
          if (held.failDriveOn?.includes(threadId) === true) throw new Error('vercel is down')
        },
        destroySandbox: async ({ threadId }) => record('row', threadId),
        findThread: async ({ threadId }: { threadId: ThreadId }) =>
          held.threads.get(threadId),
        flipToHost: async ({ threadId }) => record('flip', threadId),
        notify: (text) => {
          held.notices.push(text)
        },
        readListFailureMark: async () => held.mark ?? null,
        writeListFailureMark: async ({ mark }) => {
          held.mark = mark
        },
        clearListFailureMark: async () => {
          held.mark = null
          held.clears = (held.clears ?? 0) + 1
        },
        now: NOW,
      }),
  }
}

describe('reapExpiredCloudSandboxes', () => {
  it('destroys an expired row and flips its cloud thread to host without a notice', async () => {
    const given = fixture({
      rows: [EXPIRED],
      threads: new Map([[EXPIRED.threadId, { executionLocation: EExecutionLocation.Cloud }]]),
    })

    await given.run()

    expect(given.calls).toEqual([
      { kind: `drive:${EXPIRED.name}`, threadId: EXPIRED.threadId },
      { kind: 'row', threadId: EXPIRED.threadId },
      { kind: 'flip', threadId: EXPIRED.threadId },
    ])
    expect(given.notices).toEqual([])
  })

  it('leaves a fresh row entirely alone', async () => {
    const given = fixture({ rows: [FRESH] })

    await given.run()

    expect(given.calls).toEqual([])
    expect(given.notices).toEqual([])
  })

  it('skips the row destroy when the drive destroy fails, still reaps the other rows, and notifies the failure', async () => {
    const other = rowOf({
      threadId: 'brn_also_expired',
      lastActivityAt: EXPIRED.lastActivityAt,
    })
    const given = fixture({
      rows: [EXPIRED, other],
      failDriveOn: [EXPIRED.threadId],
    })

    await given.run()

    expect(given.calls).toEqual([
      { kind: `drive:${EXPIRED.name}`, threadId: EXPIRED.threadId },
      { kind: `drive:${other.name}`, threadId: other.threadId },
      { kind: 'row', threadId: other.threadId },
    ])
    expect(given.notices).toEqual([
      `could not retire the expired cloud sandbox for "${EXPIRED.threadId}": vercel is down — it keeps billing until it is destroyed.`,
    ])
  })

  it('does not flip a thread the local store has never heard of', async () => {
    const given = fixture({ rows: [EXPIRED] })

    await given.run()

    expect(given.calls).toEqual([
      { kind: `drive:${EXPIRED.name}`, threadId: EXPIRED.threadId },
      { kind: 'row', threadId: EXPIRED.threadId },
    ])
  })

  it('does not flip a thread that already runs on the host', async () => {
    const given = fixture({
      rows: [EXPIRED],
      threads: new Map([[EXPIRED.threadId, { executionLocation: EExecutionLocation.Host }]]),
    })

    await given.run()

    expect(given.calls.some((call) => call.kind === 'flip')).toBe(false)
  })

  it('notifies once and returns when the listing itself fails', async () => {
    const given = fixture({ failListWith: new Error('api is unreachable') })

    await given.run()

    expect(given.calls).toEqual([])
    expect(given.notices).toEqual(['the cloud sandbox reaper could not list sandboxes: api is unreachable'])
  })

  it('stamps the marker when it notifies a list failure', async () => {
    const given = fixture({ failListWith: new Error('api is unreachable') })

    await given.run()

    expect(given.held.mark).toEqual({ message: 'api is unreachable', notifiedAt: NOW })
  })

  it('stays quiet when the same failure repeats inside the notice window', async () => {
    const given = fixture({
      failListWith: new Error('api is unreachable'),
      mark: { message: 'api is unreachable', notifiedAt: NOW - 60_000 },
    })

    await given.run()

    expect(given.notices).toEqual([])
  })

  it('re-notifies when the failure message changed', async () => {
    const given = fixture({
      failListWith: new Error('quota exceeded'),
      mark: { message: 'api is unreachable', notifiedAt: NOW - 60_000 },
    })

    await given.run()

    expect(given.notices).toEqual(['the cloud sandbox reaper could not list sandboxes: quota exceeded'])
    expect(given.held.mark).toEqual({ message: 'quota exceeded', notifiedAt: NOW })
  })

  it('re-notifies the same failure once the notice window has passed', async () => {
    const given = fixture({
      failListWith: new Error('api is unreachable'),
      mark: {
        message: 'api is unreachable',
        notifiedAt: NOW - REAPER_LIST_FAILURE_NOTICE_MS - 1_000,
      },
    })

    await given.run()

    expect(given.notices).toEqual(['the cloud sandbox reaper could not list sandboxes: api is unreachable'])
  })

  it('clears the marker after a successful list', async () => {
    const given = fixture({
      rows: [FRESH],
      mark: { message: 'api is unreachable', notifiedAt: NOW - 60_000 },
    })

    await given.run()

    expect(given.held.mark).toBeNull()
    expect(given.held.clears).toBe(1)
  })

  it('still notifies every per-row reap failure regardless of the marker', async () => {
    const given = fixture({
      rows: [EXPIRED],
      failDriveOn: [EXPIRED.threadId],
      mark: { message: 'vercel is down', notifiedAt: NOW - 60_000 },
    })

    await given.run()

    expect(given.notices).toEqual([
      `could not retire the expired cloud sandbox for "${EXPIRED.threadId}": vercel is down — it keeps billing until it is destroyed.`,
    ])
  })

  it('treats a row idle for exactly the ttl as still fresh', async () => {
    const borderline = rowOf({
      threadId: 'brn_borderline',
      lastActivityAt: new Date(NOW - SANDBOX_TTL_MS).toISOString(),
    })
    const given = fixture({ rows: [borderline] })

    await given.run()

    expect(given.calls).toEqual([])
  })
})
