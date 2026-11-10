import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createV2EventSchema } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'
import { beforeEach, describe, expect, it } from 'bun:test'
import { prEventRows, seedPrState, seedSubscription } from '../../../../test/github-seed'
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
  return rows.map((row) => ({
    kind: row.kind,
    text: inboxMessageSchema.parse(JSON.parse(row.payload)).text,
  }))
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

  const seedWatchedPr = async (over: { threadId?: string; liveUntil?: Date } = {}) => {
    await seedHook({ createdBy: 'usr-creator' })
    await seedSubscription({
      userId: 'usr-a',
      prNumber: 42,
      branch: '#42',
      threadId: over.threadId ?? THREAD,
      ...(over.liveUntil === undefined ? {} : { liveUntil: over.liveUntil }),
    })
    await seedPrState({ ...FILLED_PR_STATE, checksRunning: 1, checksPassed: 0 })
  }

  it('posts one inbox message naming the PR, its checks tally and its mergeability', async () => {
    const { service } = settledGreen()
    await seedWatchedPr()

    await service.handle({ event: 'check_run', payload: SETTLING_CHECK_RUN_PAYLOAD })

    expect(await inboxOf(SESSION)).toEqual([
      {
        kind: INBOX_KIND_MESSAGE,
        text: 'GitHub: PR #42 (https://github.com/compai/app/pull/42): checks passed (3 passed, 0 failed, 0 running), and the PR is mergeable.',
      },
    ])
    const [event] = await prEventRows()
    const deliveries = await db.orm.public.GithubPrEventDelivery.where({
      eventId: event?.id ?? '',
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
})
