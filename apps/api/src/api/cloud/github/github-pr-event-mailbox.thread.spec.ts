import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  ensureUsers,
  prEventRows,
  seedPrEvent,
  seedSubscription,
} from '../../../../test/github-seed'
import { seedThreadRow } from '../../../../test/session-seed'
import { waitFor } from '../../../../test/fake-timers'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { EPrEventKind } from './github-realtime.types'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'

function serviceWith(): { mailbox: GithubPrEventMailboxService; fanout: GithubPrFanoutService } {
  const fanout = new GithubPrFanoutService(new DrainStateService())
  const wake = { notifyEvent: () => undefined } as unknown as GithubSandboxWakeService
  return { mailbox: new GithubPrEventMailboxService(fanout, wake), fanout }
}

const deliveryRows = () => db.orm.public.GithubPrEventDelivery.all()

describe('GithubPrEventMailboxService per-thread delivery', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr-a')
  })

  it('drains the events a thread subscribed to and missed, once', async () => {
    const { mailbox } = serviceWith()
    await seedSubscription({
      userId: 'usr-a',
      threadId: 'thr-1',
      createdAt: new Date(Date.now() - 60_000),
    })
    await seedPrEvent({ id: 'evt_mine', userId: 'usr-a' })
    await seedPrEvent({ id: 'evt_other_pr', userId: 'usr-a', prNumber: 7 })
    await seedPrEvent({
      id: 'evt_before_subscribe',
      userId: 'usr-a',
      createdAt: new Date(Date.now() - 120_000),
    })

    const first = await mailbox.replayForThread({ userId: 'usr-a', threadId: 'thr-1' })
    const second = await mailbox.replayForThread({ userId: 'usr-a', threadId: 'thr-1' })

    expect(first.map((event) => event.id)).toEqual(['evt_mine'])
    expect(second).toEqual([])
  })

  it('drains events for a teammate child link and claims them on the teammate thread', async () => {
    const { mailbox } = serviceWith()
    await seedThreadRow({ id: 'thr-1', userId: 'usr-a' })
    await seedThreadRow({
      id: 'mate-1',
      userId: 'usr-a',
      spawnerThreadId: 'thr-1',
      agentType: 'teammate',
    })
    await seedSubscription({
      userId: 'usr-a',
      threadId: 'mate-1',
      createdAt: new Date(Date.now() - 60_000),
    })
    await seedPrEvent({ id: 'evt_mate', userId: 'usr-a' })

    const drained = await mailbox.replayForThread({ userId: 'usr-a', threadId: 'thr-1' })

    expect(drained.map((event) => event.id)).toEqual(['evt_mate'])
    expect((await deliveryRows()).map((row) => row.threadId)).toEqual(['mate-1'])
    expect(await mailbox.replayForThread({ userId: 'usr-a', threadId: 'thr-1' })).toEqual([])
  })

  it('a user stream consuming the event does not starve the thread drain', async () => {
    const { mailbox, fanout } = serviceWith()
    await seedSubscription({
      userId: 'usr-a',
      threadId: 'thr-1',
      createdAt: new Date(Date.now() - 60_000),
    })
    fanout.openStream({ userId: 'usr-a', handler: () => undefined, eventHandler: () => undefined })

    await mailbox.record({
      userIds: ['usr-a'],
      repoFullName: 'compai/app',
      prNumber: 42,
      kind: EPrEventKind.Comment,
      payload: { url: 'https://github.com/compai/app/pull/42', authorLogin: 'x', body: 'hi' },
    })
    await waitFor(async () => {
      expect((await prEventRows())[0]?.deliveredAt).not.toBeNull()
    })

    const drained = await mailbox.replayForThread({ userId: 'usr-a', threadId: 'thr-1' })
    expect(drained).toHaveLength(1)
  })

  it('a live push to a thread stream records the delivery for that thread only', async () => {
    const { mailbox, fanout } = serviceWith()
    await seedSubscription({
      userId: 'usr-a',
      threadId: 'thr-1',
      createdAt: new Date(Date.now() - 60_000),
    })
    fanout.openStream({
      userId: 'usr-a',
      threadId: 'thr-1',
      handler: () => undefined,
      eventHandler: () => undefined,
    })

    await mailbox.record({
      userIds: ['usr-a'],
      repoFullName: 'compai/app',
      prNumber: 42,
      kind: EPrEventKind.Comment,
      payload: { url: 'https://github.com/compai/app/pull/42', authorLogin: 'x', body: 'hi' },
    })
    await waitFor(async () => {
      expect(await deliveryRows()).toHaveLength(1)
    })

    expect((await deliveryRows())[0]?.threadId).toBe('thr-1')
    expect((await prEventRows())[0]?.deliveredAt).toBeNull()
    expect(await mailbox.replayForThread({ userId: 'usr-a', threadId: 'thr-1' })).toEqual([])
  })
})
