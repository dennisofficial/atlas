import { countQueries, useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { ControlPlane } from '@dltech/atlas-control'
import { createV2EventSchema, INBOX_KIND_RECORD, inboxEventOf } from '@dltech/atlas-core'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { beforeEach, describe, expect, it } from 'bun:test'

import {
  covered,
  preparePollSweeper,
  seedSubscription,
  seedTarget,
  serviceWith,
} from './github-poll-sweeper.fixture'

const USER = 'usr_1'
const PAST = () => new Date(Date.now() - 60_000)

const subscriptions = () => db.orm.public.GithubSubscription.where({ userId: USER }).all()

const inboxRecords = async (): Promise<number> => {
  const entries = await db.orm.public.InboxEntry.all()
  return entries.filter((entry) => {
    if (entry.kind !== INBOX_KIND_RECORD) return false
    const read = inboxEventOf(entry.payload)
    return read.ok && read.event.type === 'subscription-ended'
  }).length
}

const seedV2Thread = async (args: { sessionId: string; threadId: string }): Promise<void> => {
  const plane = new ControlPlane({
    store: new PostgresControlStore(db),
    eventSchema: createV2EventSchema({ pluginBodies: [] }),
  })
  await plane.createSession({
    sessionId: args.sessionId,
    userId: USER,
    projectId: 'prj_1',
    mainThreadId: args.threadId,
  })
}

const perRowThreadReadsOf = (statements: readonly string[]): string[] =>
  statements.filter(
    (statement) =>
      statement.includes('"public"."Thread"') && !statement.includes('"GithubSubscription"'),
  )

describe('GithubPollSweeperService lapsed subscriptions', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('drops a lapsed row whose thread is a v1 thread, without a record', async () => {
    await seedSubscription({
      id: 'sub-gone',
      threadId: 'thr_v1_gone',
      expiresAt: PAST(),
      liveUntil: PAST(),
    })
    const { service } = serviceWith({})

    await service.handlePoll()

    expect(await subscriptions()).toEqual([])
    expect(await inboxRecords()).toBe(0)
  })

  it('drops a lapsed row whose thread never existed, without a record', async () => {
    await seedSubscription({
      id: 'sub-missing',
      threadId: 'thr_missing',
      expiresAt: PAST(),
      liveUntil: PAST(),
    })
    const { service } = serviceWith({})

    await service.handlePoll()

    expect(await subscriptions()).toEqual([])
    expect(await inboxRecords()).toBe(0)
  })

  it('keeps a lapsed row whose thread is a live v2 thread but still watched', async () => {
    const held = await seedSubscription({
      id: 'sub-kept',
      threadId: 'thr_v2_kept',
      expiresAt: PAST(),
      liveUntil: new Date(Date.now() + 3_600_000),
    })
    const { service } = serviceWith({})

    await service.handlePoll()

    expect((await subscriptions()).map((row) => row.id)).toEqual([held.id])
  })

  it('ends a lapsed row of a v2 thread with a subscription-ended record', async () => {
    await seedV2Thread({ sessionId: 'ses_v2_lapsed', threadId: 'thr_v2_lapsed' })
    await seedSubscription({
      id: 'sub-v2',
      threadId: 'thr_v2_lapsed',
      expiresAt: PAST(),
      liveUntil: PAST(),
    })
    const { service } = serviceWith({})

    await service.handlePoll()

    expect(await subscriptions()).toEqual([])
    expect(await inboxRecords()).toBe(1)
  })

  it('reads no thread per row for any number of lapsed v1 rows', async () => {
    for (const threadId of ['thr_v1_a', 'thr_v1_b', 'thr_v1_c']) {
      await seedSubscription({
        id: `sub-${threadId}`,
        threadId,
        expiresAt: PAST(),
        liveUntil: PAST(),
      })
    }
    const { service } = serviceWith({})

    const counter = countQueries()
    await service.handlePoll()
    const statements = counter.stop()

    expect(perRowThreadReadsOf(statements)).toEqual([])
    expect(await subscriptions()).toEqual([])
  })

  it('re-reads nothing of a dropped row on the next sweep', async () => {
    await seedSubscription({
      id: 'sub-dropped',
      threadId: 'thr_v1_dropped',
      expiresAt: PAST(),
      liveUntil: PAST(),
    })
    const { service } = serviceWith({})
    await service.handlePoll()

    const counter = countQueries()
    await service.handlePoll()
    const statements = counter.stop()

    expect(perRowThreadReadsOf(statements)).toEqual([])
  })

  it('writes no hook row for a repository the GitHub App backs', async () => {
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1' },
      ensureHook: async () => 'app-backed',
    })
    await covered()
    await seedTarget({ lookedUpAt: new Date() })

    const counter = countQueries()
    await service.handlePoll()
    const statements = counter.stop()

    expect(statements.filter((statement) => statement.includes('UPDATE "GithubRepoHook"'))).toEqual(
      [],
    )
  })
})
