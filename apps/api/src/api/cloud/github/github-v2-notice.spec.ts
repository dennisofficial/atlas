import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import {
  INBOX_KIND_EVENT,
  INBOX_KIND_RECORD,
  createV2EventSchema,
  ESubscriptionActor,
  ESubscriptionEnd,
  inboxEventOf,
  prEventContent,
  type EventBody,
} from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  prEventRows,
  seedPrEvent,
  seedPrState,
  seedSubscription,
} from '../../../../test/github-seed'
import { seedHeadChecks } from './github-pr-checks.fixture'
import {
  CHECK_SUITE_PAYLOAD,
  FILLED_PR_STATE,
  prepareDelivery,
  REST_FIELDS,
  seedHook,
  serviceWith,
  SETTLING_CHECK_RUN_PAYLOAD,
} from './github-delivery.fixture'

const SESSION = 'ses_v2'
const THREAD = 'thr_v2'

const inboxOf = async (sessionId: string) => {
  const rows = await db.orm.v2.V2InboxEntry.where({ sessionId }).all()
  return rows.map((row) => ({ kind: row.kind, read: inboxEventOf(row.payload) }))
}

const prEventOf = (entry: Awaited<ReturnType<typeof inboxOf>>[number]) => {
  if (!entry.read.ok) throw new Error(entry.read.reason)
  const event: EventBody = entry.read.event
  if (event.type !== 'pr-event') throw new Error(`expected a pr-event, got ${event.type}`)
  return event
}

describe('v2 session notice for a PR event', () => {
  useTestDatabase()

  beforeEach(async () => {
    await prepareDelivery()
    const plane = new ControlPlane({
      store: new PostgresControlStore(db),
      eventSchema: createV2EventSchema({ pluginBodies: [] }),
    })
    await plane.createSession({
      sessionId: SESSION,
      userId: 'usr-a',
      projectId: 'prj_1',
      mainThreadId: THREAD,
    })
  })

  const settledGreen = () =>
    serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      readPullRequest: async () => ({
        ...REST_FIELDS,
        checksRunning: 0,
        checksPassed: 3,
        checksFailed: 0,
      }),
    })

  const seedWatchedPr = async (
    over: { threadId?: string; liveUntil?: Date; events?: readonly string[] } = {},
  ) => {
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({
      userId: 'usr-a',
      prNumber: 42,
      branch: '#42',
      threadId: over.threadId ?? THREAD,
      ...(over.liveUntil === undefined ? {} : { liveUntil: over.liveUntil }),
      ...(over.events === undefined ? {} : { events: [...over.events] }),
    })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 1, checksPassed: 0 })
  }

  const noticeOf = async (kind: string): Promise<number> => {
    const event = await seedPrEvent({ userId: 'usr-a', kind })
    const { noticeV2Sessions } = await import('./github-v2-notice')
    return db.transaction((tx) => noticeV2Sessions({ tx, event }))
  }

  it('posts one event naming the PR, its checks tally and its mergeability', async () => {
    const { service } = settledGreen()
    await seedWatchedPr()
    await seedHeadChecks({ headSha: 'abc123', passed: 3 })

    await service.handle({ event: 'check_run', payload: SETTLING_CHECK_RUN_PAYLOAD })

    const [entry] = await inboxOf(SESSION)
    if (entry === undefined) throw new Error('no inbox entry')
    expect(entry.kind).toBe(INBOX_KIND_EVENT)
    const event = prEventOf(entry)
    expect(event).toMatchObject({
      type: 'pr-event',
      repo: 'github.com/compai/app',
      prNumber: 42,
      kind: 'verdict',
      url: 'https://github.com/compai/app/pull/42',
      verdict: 'green',
      settled: true,
      mergeable: true,
      checks: { passed: 3, failed: 0, running: 0 },
    })
    expect(prEventContent(event)).toContain(
      'all checks passed (3 passed, 0 failed, 0 running) and the PR is mergeable.',
    )
    const [row] = await prEventRows()
    expect(event.eventId).toBe(row?.id ?? '')
    const deliveries = await db.orm.public.GithubPrEventDelivery.where({
      eventId: row?.id ?? '',
    }).all()
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({ threadId: THREAD })
    expect(deliveries[0]?.ackedAt).not.toBeNull()
  })

  it('notifies once when the same event is fanned out twice', async () => {
    const { service } = settledGreen()
    await seedWatchedPr()

    await service.handle({ event: 'check_run', payload: SETTLING_CHECK_RUN_PAYLOAD })
    await service.handle({ event: 'check_run', payload: SETTLING_CHECK_RUN_PAYLOAD })
    await service.handle({ event: 'check_suite', payload: CHECK_SUITE_PAYLOAD })

    expect(await inboxOf(SESSION)).toHaveLength(1)
    expect(await prEventRows()).toHaveLength(1)
  })

  it('does not post twice for one event row delivered twice to the same thread', async () => {
    const { service } = settledGreen()
    await seedWatchedPr()
    await service.handle({ event: 'check_run', payload: SETTLING_CHECK_RUN_PAYLOAD })
    const [event] = await prEventRows()
    if (event === undefined) throw new Error('no event row')

    const { noticeV2Sessions } = await import('./github-v2-notice')
    await db.transaction((tx) => noticeV2Sessions({ tx, event }))

    expect(await inboxOf(SESSION)).toHaveLength(1)
  })

  it('says nothing after the subscription is gone or has lapsed', async () => {
    const { service } = settledGreen()
    await seedWatchedPr({ liveUntil: new Date(Date.now() - 1_000) })

    await service.handle({ event: 'check_run', payload: SETTLING_CHECK_RUN_PAYLOAD })

    expect(await inboxOf(SESSION)).toEqual([])
  })

  it('ignores a subscription whose thread is not a v2 thread', async () => {
    const { service } = settledGreen()
    await seedWatchedPr({ threadId: 'thr_v1' })

    await service.handle({ event: 'check_run', payload: SETTLING_CHECK_RUN_PAYLOAD })

    expect(await inboxOf(SESSION)).toEqual([])
    expect(await prEventRows()).toHaveLength(1)
  })

  it('notifies a subscription filtered to state when the pull request reaches a state', async () => {
    await seedWatchedPr({ events: ['state'] })

    expect(await noticeOf('state')).toBe(1)
    expect(await inboxOf(SESSION)).toHaveLength(1)
  })

  it('says nothing to a subscription that filtered the kind out', async () => {
    await seedWatchedPr({ events: ['state'] })

    expect(await noticeOf('comment')).toBe(0)
    expect(await noticeOf('verdict')).toBe(0)
    expect(await inboxOf(SESSION)).toEqual([])
  })

  it('notifies a subscription with no filter about every kind', async () => {
    await seedWatchedPr()

    expect(await noticeOf('comment')).toBe(1)
    expect(await noticeOf('verdict')).toBe(1)
  })

  it('notifies a thread that holds one wanting row and one filtered-out row', async () => {
    await seedWatchedPr({ events: ['state'] })
    await seedSubscription({
      userId: 'usr-a',
      prNumber: 42,
      branch: '#42-alt',
      threadId: THREAD,
    })

    expect(await noticeOf('comment')).toBe(1)
  })

  const stateEventOf = (state: string) =>
    seedPrEvent({
      userId: 'usr-a',
      kind: 'state',
      payload: { url: 'https://github.com/compai/app/pull/42', state },
    })

  const subscriptionsOf = () => db.orm.public.GithubSubscription.where({ userId: 'usr-a' }).all()

  const endedRecordsOf = async () => {
    const entries = await inboxOf(SESSION)
    return entries.flatMap((entry) => {
      if (entry.kind !== INBOX_KIND_RECORD || !entry.read.ok) return []
      return entry.read.event.type === 'subscription-ended' ? [entry.read.event] : []
    })
  }

  it('ends the row of the pull request once it merges', async () => {
    await seedWatchedPr()
    const [held] = await subscriptionsOf()
    const { noticeV2Sessions } = await import('./github-v2-notice')
    const event = await stateEventOf('merged')

    await db.transaction((tx) => noticeV2Sessions({ tx, event }))

    expect(await subscriptionsOf()).toEqual([])
    expect(await endedRecordsOf()).toEqual([
      {
        type: 'subscription-ended',
        subscriptionId: held?.id ?? '',
        reason: ESubscriptionEnd.Completed,
        by: ESubscriptionActor.Provider,
      },
    ])
  })

  it('ends a row whose liveness lapsed, so no notice went out', async () => {
    await seedWatchedPr({ liveUntil: new Date(Date.now() - 1_000) })
    const { noticeV2Sessions } = await import('./github-v2-notice')
    const event = await stateEventOf('closed')

    await db.transaction((tx) => noticeV2Sessions({ tx, event }))

    expect(await subscriptionsOf()).toEqual([])
    expect(await inboxOf(SESSION)).toHaveLength(1)
    expect(await endedRecordsOf()).toHaveLength(1)
  })

  it('leaves the row in place for a state that does not end the pull request', async () => {
    await seedWatchedPr()
    const { noticeV2Sessions } = await import('./github-v2-notice')
    const event = await stateEventOf('open')

    await db.transaction((tx) => noticeV2Sessions({ tx, event }))

    expect(await subscriptionsOf()).toHaveLength(1)
    expect(await endedRecordsOf()).toEqual([])
  })
})
