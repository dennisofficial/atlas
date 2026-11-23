import { useTestDatabase } from '@dltech/atlas-db/testing'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createV2EventSchema } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { EMergeQueueMove, EPrEventKind, INBOX_KIND_EVENT, inboxEventOf } from '@dltech/atlas-core'
import { beforeEach, describe, expect, it } from 'bun:test'

import { ensureUsers, seedPrState, seedSubscription } from './testing/github-seed'
import {
  mergeQueueMoveOfPullAction,
  mergeQueuePrNumberOf,
  recordMergeQueueEntry,
} from './github-merge-queue-webhook'
import type { GithubMergeQueueEntryWebhookPayload } from './github-webhook.types'

const noQueues = async (): Promise<void> => undefined

const USER = 'usr-1'
const OTHER_USER = 'usr-2'
const V2_SESSION = 'ses_v2_queue'
const V2_THREAD = 'thr_v2_queue'
const OTHER_SESSION = 'ses_v2_queue_2'
const OTHER_THREAD = 'thr_v2_queue_2'

const seedV2Thread = async (args: { sessionId: string; threadId: string; userId: string }) => {
  const plane = new ControlPlane({
    store: new PostgresControlStore(db),
    eventSchema: createV2EventSchema({ pluginBodies: [] }),
  })
  await plane.createSession({
    sessionId: args.sessionId,
    userId: args.userId,
    projectId: 'prj_1',
    mainThreadId: args.threadId,
  })
}

const inboxEvents = async (sessionId: string) => {
  const entries = await db.orm.v2.V2InboxEntry.where({ sessionId }).all()
  return entries.map((entry) => ({ kind: entry.kind, payload: inboxEventOf(entry.payload) }))
}

const eventOf = (read: Awaited<ReturnType<typeof inboxEvents>>[number]) => {
  if (!read.payload.ok) throw new Error(read.payload.reason)
  return read.payload.event
}

const queueMoveOf = (read: Awaited<ReturnType<typeof inboxEvents>>[number]) => {
  const event = eventOf(read)
  if (event.type !== 'pr-event') throw new Error(`expected a pr-event, got ${event.type}`)
  return { kind: read.kind, event }
}

const payloadOf = (
  overrides: {
    action?: string
    prNumber?: number | undefined
    headRef?: string
    repo?: string
  } = {},
): GithubMergeQueueEntryWebhookPayload => {
  const prNumber = 'prNumber' in overrides ? overrides.prNumber : 42
  return {
    action: overrides.action ?? 'added',
    ...(prNumber === undefined ? {} : { pull_request: { number: prNumber } }),
    merge_group: {
      head_ref:
        overrides.headRef ??
        'refs/heads/gh-readonly-queue/main/pr-42-02f7a1b9baa42e0c0c1b5b7c8b4c4c4b6a2e21c1',
      base_ref: 'refs/heads/main',
    },
    repository: { full_name: overrides.repo ?? 'compai/app' },
  }
}

describe('recordMergeQueueEntry', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers(USER, OTHER_USER)
    await seedPrState({ repoFullName: 'compai/app', prNumber: 42 })
  })

  it('tells the pull request row that it entered and left the queue', async () => {
    const moves: { repoFullName: string; prNumber: number; mergeQueued: boolean }[] = []
    const queue = async (move: (typeof moves)[number]): Promise<void> => {
      moves.push(move)
    }

    await recordMergeQueueEntry({ queues: queue, payload: payloadOf({ action: 'added' }) })
    await recordMergeQueueEntry({ queues: queue, payload: payloadOf({ action: 'removed' }) })

    expect(moves).toEqual([
      { repoFullName: 'compai/app', prNumber: 42, mergeQueued: true },
      { repoFullName: 'compai/app', prNumber: 42, mergeQueued: false },
    ])
  })

  it('notifies the subscribed thread that the PR entered the queue', async () => {
    await seedV2Thread({ sessionId: V2_SESSION, threadId: V2_THREAD, userId: USER })
    await seedSubscription({ userId: USER, prNumber: 42, threadId: V2_THREAD })

    expect(await recordMergeQueueEntry({ queues: noQueues, payload: payloadOf() })).toBe(1)

    const [entry] = await inboxEvents(V2_SESSION)
    if (entry === undefined) throw new Error('no inbox entry')
    expect(queueMoveOf(entry)).toEqual({
      kind: INBOX_KIND_EVENT,
      event: {
        type: 'pr-event',
        repo: 'github.com/compai/app',
        prNumber: 42,
        kind: EPrEventKind.MergeQueue,
        url: 'https://github.com/compai/app/pull/42',
        queue: EMergeQueueMove.Entered,
      },
    })
  })

  it('says the PR left the queue on a removal', async () => {
    await seedV2Thread({ sessionId: V2_SESSION, threadId: V2_THREAD, userId: USER })
    await seedSubscription({ userId: USER, prNumber: 42, threadId: V2_THREAD })

    expect(
      await recordMergeQueueEntry({ queues: noQueues, payload: payloadOf({ action: 'removed' }) }),
    ).toBe(1)

    const [entry] = await inboxEvents(V2_SESSION)
    if (entry === undefined) throw new Error('no inbox entry')
    expect(queueMoveOf(entry).event).toMatchObject({
      kind: EPrEventKind.MergeQueue,
      queue: EMergeQueueMove.Left,
    })
  })

  it('notifies every subscribed thread of the PR once', async () => {
    await seedV2Thread({ sessionId: V2_SESSION, threadId: V2_THREAD, userId: USER })
    await seedV2Thread({
      sessionId: OTHER_SESSION,
      threadId: OTHER_THREAD,
      userId: OTHER_USER,
    })
    await seedSubscription({ userId: USER, prNumber: 42, threadId: V2_THREAD })
    await seedSubscription({ userId: OTHER_USER, prNumber: 42, threadId: OTHER_THREAD })

    expect(await recordMergeQueueEntry({ queues: noQueues, payload: payloadOf() })).toBe(2)

    expect(await inboxEvents(V2_SESSION)).toHaveLength(1)
    expect(await inboxEvents(OTHER_SESSION)).toHaveLength(1)
  })

  it('reaches a branch subscriber whose branch is the PR head', async () => {
    await seedV2Thread({ sessionId: V2_SESSION, threadId: V2_THREAD, userId: USER })
    await seedSubscription({
      userId: USER,
      prNumber: null,
      branch: 'dennis/add-the-thing',
      threadId: V2_THREAD,
    })

    expect(await recordMergeQueueEntry({ queues: noQueues, payload: payloadOf() })).toBe(1)
    expect(await inboxEvents(V2_SESSION)).toHaveLength(1)
  })

  it('writes nothing for a PR it has no state row for', async () => {
    await seedV2Thread({ sessionId: V2_SESSION, threadId: V2_THREAD, userId: USER })
    await seedSubscription({ userId: USER, prNumber: 42, threadId: V2_THREAD })

    expect(
      await recordMergeQueueEntry({ queues: noQueues, payload: payloadOf({ prNumber: 43 }) }),
    ).toBe(0)
    expect(await inboxEvents(V2_SESSION)).toEqual([])
  })

  it('writes nothing for an action that is not an entry or an exit', async () => {
    await seedV2Thread({ sessionId: V2_SESSION, threadId: V2_THREAD, userId: USER })
    await seedSubscription({ userId: USER, prNumber: 42, threadId: V2_THREAD })

    expect(
      await recordMergeQueueEntry({
        queues: noQueues,
        payload: payloadOf({ action: 'destroyed' }),
      }),
    ).toBe(0)
    expect(await inboxEvents(V2_SESSION)).toEqual([])
  })

  it('reads the PR number out of the queue head ref when the payload omits the pull request', async () => {
    await seedV2Thread({ sessionId: V2_SESSION, threadId: V2_THREAD, userId: USER })
    await seedSubscription({ userId: USER, prNumber: 42, threadId: V2_THREAD })

    expect(mergeQueuePrNumberOf(payloadOf({ prNumber: undefined }))).toBe(42)
    expect(
      await recordMergeQueueEntry({
        queues: noQueues,
        payload: payloadOf({ prNumber: undefined }),
      }),
    ).toBe(1)
    const [entry] = await inboxEvents(V2_SESSION)
    if (entry === undefined) throw new Error('no inbox entry')
    expect(queueMoveOf(entry)).toEqual({
      kind: INBOX_KIND_EVENT,
      event: {
        type: 'pr-event',
        repo: 'github.com/compai/app',
        prNumber: 42,
        kind: EPrEventKind.MergeQueue,
        url: 'https://github.com/compai/app/pull/42',
        queue: EMergeQueueMove.Entered,
      },
    })
  })

  it('reads no PR number from a head ref that names none', () => {
    expect(
      mergeQueuePrNumberOf(payloadOf({ prNumber: undefined, headRef: 'refs/heads/main' })),
    ).toBe(null)
  })
})

describe('mergeQueueMoveOfPullAction', () => {
  it('reads enqueued and dequeued pull_request actions as queue moves', () => {
    expect(mergeQueueMoveOfPullAction('enqueued')).toBe(EMergeQueueMove.Entered)
    expect(mergeQueueMoveOfPullAction('dequeued')).toBe(EMergeQueueMove.Left)
    expect(mergeQueueMoveOfPullAction('synchronize')).toBe(null)
  })
})
