import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import {
  createV2EventSchema,
  ESubscriptionActor,
  ESubscriptionEnd,
  INBOX_KIND_RECORD,
  inboxEventOf,
} from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'

import { seedSubscription } from '../../../../test/github-seed'
import { preparePollSweeper, serviceWith } from './github-poll-sweeper.fixture'

const USER = 'usr_1'
const SESSION = 'ses_v2_expiry'
const THREAD = 'thr_v2_expiry'

const PAST = () => new Date(Date.now() - 60_000)
const FUTURE = () => new Date(Date.now() + 3_600_000)

const seedV2Thread = async () => {
  const plane = new ControlPlane({
    store: new PostgresControlStore(db),
    eventSchema: createV2EventSchema({ pluginBodies: [] }),
  })
  await plane.createSession({
    sessionId: SESSION,
    userId: USER,
    projectId: 'prj_1',
    mainThreadId: THREAD,
  })
}

const subscriptions = () => db.orm.public.GithubSubscription.where({ userId: USER }).all()

const endedRecordsOf = async () => {
  const entries = await db.orm.v2.V2InboxEntry.where({ sessionId: SESSION }).all()
  return entries.flatMap((entry) => {
    if (entry.kind !== INBOX_KIND_RECORD) return []
    const read = inboxEventOf(entry.payload)
    return read.ok && read.event.type === 'subscription-ended' ? [read.event] : []
  })
}

describe('GithubPollSweeperService expiry', () => {
  useTestDatabase()

  beforeEach(async () => {
    await preparePollSweeper()
    await seedV2Thread()
  })

  it('ends a lapsed row of a session thread as expired by the clock', async () => {
    const held = await seedSubscription({
      userId: USER,
      threadId: THREAD,
      expiresAt: PAST(),
      liveUntil: PAST(),
    })
    const { service } = serviceWith({})

    await service.handlePoll()

    expect(await subscriptions()).toEqual([])
    expect(await endedRecordsOf()).toEqual([
      {
        type: 'subscription-ended',
        subscriptionId: held.id,
        reason: ESubscriptionEnd.Expired,
        by: ESubscriptionActor.Clock,
      },
    ])
  })

  it('keeps a row whose liveness outlived its expiry, as an active thread does', async () => {
    await seedSubscription({
      userId: USER,
      threadId: THREAD,
      expiresAt: PAST(),
      liveUntil: FUTURE(),
    })
    const { service } = serviceWith({})

    await service.handlePoll()

    expect(await subscriptions()).toHaveLength(1)
    expect(await endedRecordsOf()).toEqual([])
  })

  it('ends a row that named its own expiry even while the thread is active', async () => {
    const held = await seedSubscription({
      userId: USER,
      threadId: THREAD,
      expiresAt: PAST(),
      liveUntil: FUTURE(),
      deadline: PAST(),
    })
    const { service } = serviceWith({})

    await service.handlePoll()

    expect(await subscriptions()).toEqual([])
    expect(await endedRecordsOf()).toEqual([
      {
        type: 'subscription-ended',
        subscriptionId: held.id,
        reason: ESubscriptionEnd.Expired,
        by: ESubscriptionActor.Clock,
      },
    ])
  })

  it('keeps a row that is not linked to a session thread', async () => {
    await seedSubscription({ userId: USER, threadId: '', expiresAt: PAST(), liveUntil: PAST() })
    const { service } = serviceWith({})

    await service.handlePoll()

    expect(await subscriptions()).toHaveLength(1)
  })
})
