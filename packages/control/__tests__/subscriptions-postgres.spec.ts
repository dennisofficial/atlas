import { describe, expect, it } from 'bun:test'

import { ESubscriptionActor, ESubscriptionEnd, INBOX_KIND_RECORD } from '@dltech/atlas-core'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import { endSubscriptionsIn } from '../src/subscription-endings'

const REPO = 'github.com/acme/atlas'

describe('subscription rows on postgres', () => {
  const testDb = useTestDatabase()

  const plane = () => new ControlPlane({ store: new PostgresControlStore(testDb().db) })

  const seeded = async () => {
    const control = plane()
    const suffix = crypto.randomUUID()
    const userId = `user-sub-${suffix}`
    await seedUser({ db: testDb().db, id: userId })
    await control.createSession({
      sessionId: `session-sub-${suffix}`,
      userId,
      projectId: null,
      mainThreadId: `thread-sub-${suffix}`,
    })
    return {
      plane: control,
      userId,
      sessionId: `session-sub-${suffix}`,
      threadId: `thread-sub-${suffix}`,
    }
  }

  it('round-trips a row and its record through a real transaction', async () => {
    const { plane: control, sessionId, threadId } = await seeded()
    const result = await control.subscribe({
      sessionId,
      threadId,
      provider: 'github.pull-request',
      target: { repo: REPO, number: 7 },
      label: 'acme/atlas#7',
      events: ['check_run'],
      lease: { repo: REPO, subject: { kind: 'pull-request', number: 7 } },
      by: ESubscriptionActor.Agent,
    })

    expect(result.existed).toBe(false)
    expect(await control.listSubscriptions({ sessionId })).toEqual([result.subscription])
    const records = (
      await control.readInbox({ sessionId, afterId: 0, limit: 10, forThread: null })
    ).filter((entry) => entry.kind === INBOX_KIND_RECORD)
    expect(records).toHaveLength(1)
    expect(JSON.parse(records[0]?.payload ?? '{}')).toMatchObject({
      event: { type: 'subscription-created', subscriptionId: result.subscription.id },
    })

    const repeated = await control.subscribe({
      sessionId,
      threadId,
      provider: 'github.pull-request',
      target: { repo: REPO, number: 7 },
      label: 'acme/atlas#7',
      events: ['check_run'],
      lease: { repo: REPO, subject: { kind: 'pull-request', number: 7 } },
      by: ESubscriptionActor.Agent,
    })
    expect([repeated.existed, repeated.updated]).toEqual([true, false])

    const changed = await control.subscribe({
      sessionId,
      threadId,
      provider: 'github.pull-request',
      target: { repo: REPO, number: 7 },
      label: 'acme/atlas#7',
      events: ['push'],
      expiresAt: result.subscription.expiresAt ?? undefined,
      lease: { repo: REPO, subject: { kind: 'pull-request', number: 7 } },
      by: ESubscriptionActor.Agent,
    })
    expect([changed.existed, changed.updated]).toEqual([true, true])
    expect((await control.listSubscriptions({ sessionId }))[0]?.events).toEqual(['push'])

    expect(
      await control.unsubscribe({
        sessionId,
        subscriptionId: result.subscription.id,
        by: ESubscriptionActor.Operator,
        reason: ESubscriptionEnd.Unsubscribed,
      }),
    ).toEqual({ ended: true })
    expect(await control.listSubscriptions({ sessionId })).toEqual([])
  })

  it('lists a row the append hook wrote before the row columns existed', async () => {
    const store = new PostgresControlStore(testDb().db)
    const control = new ControlPlane({ store })
    const suffix = crypto.randomUUID()
    const sessionId = `session-legacy-${suffix}`
    const threadId = `thread-legacy-${suffix}`
    const userId = `user-legacy-${suffix}`
    await seedUser({ db: testDb().db, id: userId })
    await control.createSession({
      sessionId,
      userId,
      projectId: null,
      mainThreadId: threadId,
    })
    await store.transact((tx) =>
      tx.upsertSubscriptionLease({
        userId,
        threadId,
        repo: REPO,
        subject: { kind: 'pull-request', number: 11 },
        events: [],
        expiresAt: '2026-11-23T00:00:00.000Z',
      }),
    )

    expect(await control.listSubscriptions({ sessionId })).toMatchObject([
      { provider: 'github.pull-request', label: 'acme/atlas#11', createdAt: expect.any(String) },
    ])
  })

  it('lets only one of two concurrent subscribes insert the row', async () => {
    const { plane: control, sessionId, threadId } = await seeded()
    const subscribe = () =>
      control.subscribe({
        sessionId,
        threadId,
        provider: 'github.pull-request',
        target: { repo: REPO, number: 7 },
        label: 'acme/atlas#7',
        events: ['check_run'],
        lease: { repo: REPO, subject: { kind: 'pull-request', number: 7 } },
        by: ESubscriptionActor.Agent,
      })

    const results = await Promise.all([subscribe(), subscribe()])

    expect(results.map((result) => result.existed).sort()).toEqual([false, true])
    expect(new Set(results.map((result) => result.subscription.id)).size).toBe(1)
    expect(await control.listSubscriptions({ sessionId })).toHaveLength(1)
    const records = (
      await control.readInbox({ sessionId, afterId: 0, limit: 10, forThread: null })
    ).filter((entry) => entry.kind === INBOX_KIND_RECORD)
    expect(records).toHaveLength(1)
  })

  it('keeps a row renewed between the sweep selection and its delete', async () => {
    const { plane: control, sessionId, threadId } = await seeded()
    const subscribe = (expiresAt: string) =>
      control.subscribe({
        sessionId,
        threadId,
        provider: 'github.pull-request',
        target: { repo: REPO, number: 7 },
        label: 'acme/atlas#7',
        events: [],
        expiresAt,
        lease: { repo: REPO, subject: { kind: 'pull-request', number: 7 } },
        by: ESubscriptionActor.Agent,
      })
    const expired = await subscribe('2020-01-01T00:00:00.000Z')
    await subscribe('2030-01-01T00:00:00.000Z')

    const ended = await new PostgresControlStore(testDb().db).transact((tx) =>
      endSubscriptionsIn({
        tx,
        rows: [{ subscriptionId: expired.subscription.id, threadId }],
        by: ESubscriptionActor.Clock,
        reason: ESubscriptionEnd.Expired,
        at: '2026-11-22T12:00:00.000Z',
        endedBefore: '2026-11-22T12:00:00.000Z',
      }),
    )

    expect(ended).toBe(0)
    expect(await control.listSubscriptions({ sessionId })).toHaveLength(1)
  })
})
