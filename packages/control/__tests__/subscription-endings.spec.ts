import { describe, expect, it } from 'bun:test'

import {
  ESubscriptionActor,
  ESubscriptionEnd,
  INBOX_KIND_RECORD,
  inboxEventOf,
  type EventBody,
} from '@dltech/atlas-core'

import { ControlPlane } from '../src/control-plane'
import { endSubscriptionsIn, type SubscriptionEndingRow } from '../src/subscription-endings'
import { InMemoryControlStore } from '../src/testing/memory'

const NOW = '2026-11-22T12:00:00.000Z'
const SESSION = 'session-1'
const MAIN = 'thread-main'

const setup = async () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const plane = new ControlPlane({ store, clock: () => NOW })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-a',
    projectId: 'project-a',
    mainThreadId: MAIN,
  })
  return { store, plane }
}

const watch = (plane: ControlPlane) =>
  plane.subscribe({
    sessionId: SESSION,
    threadId: MAIN,
    provider: 'github.pull-request',
    target: { repo: 'github.com/compai/app', number: 7 },
    label: 'compai/app#7',
    events: [],
    lease: { repo: 'compai/app', subject: { kind: 'pull-request', number: 7 } },
    by: ESubscriptionActor.Agent,
  })

const liveRows = async (store: InMemoryControlStore): Promise<readonly SubscriptionEndingRow[]> => {
  const rows = await store.transact((tx) => tx.readSessionSubscriptionRows(SESSION))
  return rows.map((row) => ({ subscriptionId: row.subscriptionId, threadId: row.threadId }))
}

const endedRecordsOf = async (plane: ControlPlane): Promise<EventBody[]> => {
  const entries = await plane.readInbox({ sessionId: SESSION, afterId: 0, limit: 100 })
  return entries
    .filter((entry) => entry.kind === INBOX_KIND_RECORD)
    .flatMap((entry) => {
      const read = inboxEventOf(entry.payload)
      return read.ok && read.event.type === 'subscription-ended' ? [read.event] : []
    })
}

describe('endSubscriptionsIn', () => {
  it('deletes the row and records why it ended', async () => {
    const { store, plane } = await setup()
    const { subscription } = await watch(plane)

    const rows = await liveRows(store)
    const ended = await store.transact((tx) =>
      endSubscriptionsIn({
        tx,
        rows,
        by: ESubscriptionActor.Provider,
        reason: ESubscriptionEnd.Completed,
        at: NOW,
      }),
    )

    expect(ended).toBe(1)
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toEqual([])
    expect(await endedRecordsOf(plane)).toEqual([
      {
        type: 'subscription-ended',
        subscriptionId: subscription.id,
        reason: ESubscriptionEnd.Completed,
        by: ESubscriptionActor.Provider,
      },
    ])
  })

  it('ends once: a second pass over the same rows writes no further record', async () => {
    const { store, plane } = await setup()
    await watch(plane)
    const rows = await liveRows(store)
    const end = () =>
      store.transact((tx) =>
        endSubscriptionsIn({
          tx,
          rows,
          by: ESubscriptionActor.Clock,
          reason: ESubscriptionEnd.Expired,
          at: NOW,
        }),
      )

    expect(await end()).toBe(1)
    expect(await end()).toBe(0)
    expect(await endedRecordsOf(plane)).toHaveLength(1)
  })

  it('leaves a row alone when its thread is not a session thread', async () => {
    const { store, plane } = await setup()
    const written = await store.transact((tx) =>
      tx.insertSubscriptionRow({
        userId: 'user-a',
        repoFullName: 'compai/app',
        branch: '#42',
        threadId: 'thread-v1',
        sessionId: SESSION,
        provider: 'github.pull-request',
        kind: 'pull-request',
        prNumber: 42,
        target: null,
        label: '',
        createdBy: ESubscriptionActor.Operator,
        events: [],
        expiresAt: NOW,
        deadline: null,
        createdAt: NOW,
      }),
    )

    const ended = await store.transact((tx) =>
      endSubscriptionsIn({
        tx,
        rows: [{ subscriptionId: written.row.subscriptionId, threadId: written.row.threadId }],
        by: ESubscriptionActor.Clock,
        reason: ESubscriptionEnd.Expired,
        at: NOW,
      }),
    )

    expect(ended).toBe(0)
    expect(
      await store.transact((tx) => tx.readSubscription(written.row.subscriptionId)),
    ).toBeDefined()
    expect(await endedRecordsOf(plane)).toEqual([])
  })
})

describe('ControlPlane.endSubscriptions', () => {
  it('ends every row of the session, as archiving it does', async () => {
    const { plane } = await setup()
    await watch(plane)
    await plane.subscribe({
      sessionId: SESSION,
      threadId: MAIN,
      provider: 'github.workflow-run',
      target: {
        kind: 'workflow-run',
        repo: 'github.com/compai/app',
        selector: '#workflow:ci@main',
      },
      label: 'compai/app#workflow:ci@main',
      events: [],
      lease: {
        repo: 'compai/app',
        subject: { kind: 'workflow-run', selector: '#workflow:ci@main' },
      },
      by: ESubscriptionActor.Agent,
    })

    const ended = await plane.endSubscriptions({
      sessionId: SESSION,
      by: ESubscriptionActor.Operator,
      reason: ESubscriptionEnd.Archived,
    })

    expect(ended).toBe(2)
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toEqual([])
    expect((await endedRecordsOf(plane)).map((event) => event.type)).toEqual([
      'subscription-ended',
      'subscription-ended',
    ])
  })
})
