import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toThreadId, type ThreadId } from '@dltech/atlas-core'
import { ECloudSandboxState, type WireSandboxListEntry } from '@dltech/atlas-harness'

import { reapExpiredCloudSandboxes, SANDBOX_TTL_MS, type ReapedThread } from '../reaper'

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
}

const fixture = (given: Partial<Fixture>) => {
  const held: Fixture = {
    rows: [],
    threads: new Map(),
    calls: [],
    notices: [],
    ...given,
  }
  const record = (kind: string, threadId: string): void => {
    held.calls.push({ kind, threadId })
  }
  return {
    ...held,
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
        now: NOW,
      }),
  }
}

describe('reapExpiredCloudSandboxes', () => {
  it('destroys an expired row, flips its cloud thread to host, and says what was lost', async () => {
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
    expect(given.notices).toEqual([
      `the cloud workspace for "${EXPIRED.threadId}" expired after 7 days idle — the sandbox, its drive, and any turns that ran in the cloud are gone; the conversation continues from the local transcript.`,
    ])
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
    expect(given.notices.some((text) => text.includes(EXPIRED.threadId))).toBe(true)
    expect(given.notices.some((text) => text.includes(other.threadId))).toBe(true)
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
