import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import {
  createRecordEventSchema,
  EPrEventKind,
  INBOX_KIND_EVENT,
  inboxEventOf,
} from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'

import { autoMergeOffEventOf, notifyAutoMergeOff } from './github-auto-merge-notice'
import { PULL_REQUEST_PAYLOAD, prepareDelivery, serviceWith } from './github-delivery.fixture'
import { ensureUsers, seedPrState, seedSubscription } from './testing/github-seed'

const USER = 'usr-1'
const OTHER_USER = 'usr-2'
const SESSION = 'ses_v2_auto_merge'
const THREAD = 'thr_v2_auto_merge'
const OTHER_SESSION = 'ses_v2_auto_merge_2'
const OTHER_THREAD = 'thr_v2_auto_merge_2'

const payloadEventOf = (payload: string) => {
  const read = inboxEventOf(payload)
  if (!read.ok) throw new Error(read.reason)
  return read.event
}

const seedThread = async (args: { sessionId: string; threadId: string; userId: string }) => {
  const plane = new ControlPlane({
    store: new PostgresControlStore(db),
    eventSchema: createRecordEventSchema({ pluginBodies: [] }),
  })
  await plane.createSession({
    sessionId: args.sessionId,
    userId: args.userId,
    projectId: 'prj_1',
    mainThreadId: args.threadId,
  })
}

const inboxEvents = async (sessionId: string) => {
  const entries = await db.orm.public.InboxEntry.where({ sessionId }).all()
  return entries.map((entry) => ({ kind: entry.kind, payload: inboxEventOf(entry.payload) }))
}

const prEventOf = (read: Awaited<ReturnType<typeof inboxEvents>>[number]) => {
  if (!read.payload.ok) throw new Error(read.payload.reason)
  if (read.payload.event.type !== 'pr-event') throw new Error('expected a pr-event')
  return { kind: read.kind, event: read.payload.event }
}

const pullRequestPayload = (args: {
  action: string
  autoMerge?: unknown
  reason?: string | null
}) => ({
  ...PULL_REQUEST_PAYLOAD,
  action: args.action,
  ...(args.reason === undefined ? {} : { reason: args.reason }),
  pull_request: {
    ...PULL_REQUEST_PAYLOAD.pull_request,
    auto_merge: args.autoMerge ?? null,
  },
})

describe('autoMergeOffEventOf', () => {
  it('carries GitHub reason for turning auto-merge off', () => {
    expect(
      payloadEventOf(
        autoMergeOffEventOf({
          repoFullName: 'compai/app',
          prNumber: 42,
          reason: 'Repository rule violations found',
        }),
      ),
    ).toEqual({
      type: 'pr-event',
      repo: 'github.com/compai/app',
      prNumber: 42,
      kind: EPrEventKind.AutoMergeOff,
      url: 'https://github.com/compai/app/pull/42',
      reason: 'Repository rule violations found',
    })
  })

  it('omits a reason GitHub did not give, or gave blank', () => {
    for (const reason of [undefined, null, '', '   ']) {
      expect(
        payloadEventOf(autoMergeOffEventOf({ repoFullName: 'compai/app', prNumber: 42, reason })),
      ).toEqual({
        type: 'pr-event',
        repo: 'github.com/compai/app',
        prNumber: 42,
        kind: EPrEventKind.AutoMergeOff,
        url: 'https://github.com/compai/app/pull/42',
      })
    }
  })
})

describe('notifyAutoMergeOff', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers(USER, OTHER_USER)
    await seedPrState({ repoFullName: 'compai/app', prNumber: 42 })
  })

  it('notifies the subscribed thread that auto-merge is off', async () => {
    await seedThread({ sessionId: SESSION, threadId: THREAD, userId: USER })
    await seedSubscription({ userId: USER, prNumber: 42, threadId: THREAD })

    expect(
      await notifyAutoMergeOff({
        repoFullName: 'compai/app',
        prNumber: 42,
        reason: 'Repository rule violations found',
      }),
    ).toBe(1)

    const [entry] = await inboxEvents(SESSION)
    if (entry === undefined) throw new Error('no inbox entry')
    expect(prEventOf(entry)).toEqual({
      kind: INBOX_KIND_EVENT,
      event: {
        type: 'pr-event',
        repo: 'github.com/compai/app',
        prNumber: 42,
        kind: EPrEventKind.AutoMergeOff,
        url: 'https://github.com/compai/app/pull/42',
        reason: 'Repository rule violations found',
      },
    })
  })

  it('notifies every subscribed thread of the PR once', async () => {
    await seedThread({ sessionId: SESSION, threadId: THREAD, userId: USER })
    await seedThread({ sessionId: OTHER_SESSION, threadId: OTHER_THREAD, userId: OTHER_USER })
    await seedSubscription({ userId: USER, prNumber: 42, threadId: THREAD })
    await seedSubscription({ userId: OTHER_USER, prNumber: 42, threadId: OTHER_THREAD })

    expect(await notifyAutoMergeOff({ repoFullName: 'compai/app', prNumber: 42 })).toBe(2)

    expect(await inboxEvents(SESSION)).toHaveLength(1)
    expect(await inboxEvents(OTHER_SESSION)).toHaveLength(1)
  })

  it('writes nothing for a PR it has no state row for', async () => {
    await seedThread({ sessionId: SESSION, threadId: THREAD, userId: USER })
    await seedSubscription({ userId: USER, prNumber: 42, threadId: THREAD })

    expect(await notifyAutoMergeOff({ repoFullName: 'compai/app', prNumber: 43 })).toBe(0)
    expect(await inboxEvents(SESSION)).toEqual([])
  })
})

describe('GithubDeliveryService auto-merge actions', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('notifies the subscribed thread when GitHub turns auto-merge off', async () => {
    const { service } = serviceWith({})
    await seedThread({ sessionId: SESSION, threadId: THREAD, userId: 'usr-a' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42, threadId: THREAD })

    await service.handle({
      event: 'pull_request',
      payload: pullRequestPayload({
        action: 'auto_merge_disabled',
        reason: 'Repository rule violations found',
      }),
    })

    const entries = await inboxEvents(SESSION)
    expect(entries).toHaveLength(1)
    expect(prEventOf(entries[0]!)).toMatchObject({
      kind: INBOX_KIND_EVENT,
      event: {
        type: 'pr-event',
        prNumber: 42,
        kind: EPrEventKind.AutoMergeOff,
        reason: 'Repository rule violations found',
      },
    })
  })

  it('notifies when the payload carries no reason', async () => {
    const { service } = serviceWith({})
    await seedThread({ sessionId: SESSION, threadId: THREAD, userId: 'usr-a' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42, threadId: THREAD })

    await service.handle({
      event: 'pull_request',
      payload: pullRequestPayload({ action: 'auto_merge_disabled' }),
    })

    const entries = await inboxEvents(SESSION)
    expect(entries).toHaveLength(1)
    expect(prEventOf(entries[0]!).event).not.toHaveProperty('reason')
  })

  it('writes no auto-merge notice for other pull request actions', async () => {
    const { service } = serviceWith({})
    await seedThread({ sessionId: SESSION, threadId: THREAD, userId: 'usr-a' })
    await seedSubscription({ userId: 'usr-a', prNumber: 42, threadId: THREAD })

    for (const action of ['auto_merge_enabled', 'edited']) {
      await service.handle({
        event: 'pull_request',
        payload: pullRequestPayload({ action, autoMerge: { enabled_by: 'octocat' } }),
      })
    }

    expect(await inboxEvents(SESSION)).toEqual([])
  })
})
