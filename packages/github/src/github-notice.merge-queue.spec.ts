import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { createRecordEventSchema, inboxEventOf, prEventContent } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { FILLED_PR_STATE, prepareDelivery, seedHook } from './github-delivery.fixture'
import { noticeSessions } from './github-notice'
import { seedPrEvent, seedPrState, seedSubscription } from './testing/github-seed'

const SESSION = 'ses_queue'
const THREAD = 'thr_queue'

const seedWatchedPr = async (mergeQueued: boolean) => {
  await seedHook({ createdBy: 'usr-creator' })
  await seedSubscription({ userId: 'usr-a', prNumber: 42, branch: '#42', threadId: THREAD })
  await seedPrState({ ...FILLED_PR_STATE, checksRunning: 0, mergeQueued })
}

const verdictNoticeOf = async (verdict: 'green' | 'failed') => {
  const event = await seedPrEvent({
    userId: 'usr-a',
    kind: 'verdict',
    payload: { url: 'https://github.com/compai/app/pull/42', verdict, settled: true },
  })
  await db.transaction((tx) => noticeSessions({ tx, event }))
  const rows = await db.orm.public.InboxEntry.where({ sessionId: SESSION }).all()
  const read = inboxEventOf(rows.at(-1)?.payload ?? '')
  if (!read.ok) throw new Error(read.reason)
  if (read.event.type !== 'pr-event') throw new Error(`expected a pr-event, got ${read.event.type}`)
  return read.event
}

describe('a CI notice for a PR in the merge queue', () => {
  useTestDatabase()

  beforeEach(async () => {
    await prepareDelivery()
    const plane = new ControlPlane({
      store: new PostgresControlStore(db),
      eventSchema: createRecordEventSchema({ pluginBodies: [] }),
    })
    await plane.createSession({
      sessionId: SESSION,
      userId: 'usr-a',
      projectId: 'prj_1',
      mainThreadId: THREAD,
    })
  })

  it('tells a failed verdict that the PR is still in the merge queue', async () => {
    await seedWatchedPr(true)

    const failed = await verdictNoticeOf('failed')

    expect(failed.mergeQueued).toBe(true)
    expect(prEventContent(failed)).toContain(
      '0 running). The PR is still in the merge queue. A failed check on the PR head does not remove it.',
    )
  })

  it('says nothing about the queue for a green verdict', async () => {
    await seedWatchedPr(true)

    expect((await verdictNoticeOf('green')).mergeQueued).toBeUndefined()
  })

  it('says nothing about the queue for a failed verdict on an unqueued PR', async () => {
    await seedWatchedPr(false)

    const failed = await verdictNoticeOf('failed')

    expect(failed.mergeQueued).toBeUndefined()
    expect(prEventContent(failed)).not.toContain('merge queue')
  })
})
