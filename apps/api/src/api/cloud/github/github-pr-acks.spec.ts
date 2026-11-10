import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedPrEvent, seedSubscription } from '../../../../test/github-seed'
import { waitFor } from '../../../../test/fake-timers'
import { DrainStateService } from '../../platform/health/drain-state.service'
import type { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { prepareDelivery, serviceWith } from './github-delivery.fixture'
import { localObservations } from './github-observation.fixture'
import { fakeSubscriptions, sandboxCtxFor } from './github-pr-stream.fixture'
import { GithubPrStreamRouter } from './github-pr-stream.router'
import type { GithubSubscriptionsService } from './github-subscriptions.service'

const COMMENT_PAYLOAD = {
  action: 'created',
  issue: {
    number: 42,
    html_url: 'https://github.com/compai/app/pull/42',
    pull_request: { html_url: 'https://github.com/compai/app/pull/42' },
  },
  comment: { body: 'ship it', html_url: 'https://github.com/compai/app/pull/42#issuecomment-1' },
  sender: { login: 'dennis' },
  repository: { full_name: 'compai/app' },
}

const deliveryRows = () => db.orm.public.GithubPrEventDelivery.all()

const familySandboxes = {
  async assertThreadInFamily(args: { sandboxThreadId: string; threadId: string }): Promise<void> {
    if (args.threadId === args.sandboxThreadId) return
    const child = await db.orm.public.Thread.where({
      id: args.threadId,
      spawnerThreadId: args.sandboxThreadId,
    })
      .select('id')
      .first()
    if (child === null) throw new Error('outside the thread family')
  },
}

describe('github pr-event deliveries', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('writes a delivery row only for the threads subscribed to the delivered pr', async () => {
    const { service, fanout } = serviceWith({ tokens: {} })
    await seedSubscription({
      userId: 'usr-a',
      threadId: 'thr-watches',
      prNumber: 42,
      branch: '#42',
    })
    await seedSubscription({ userId: 'usr-a', threadId: 'thr-other', prNumber: 7, branch: '#7' })

    const seen: string[] = []
    for (const threadId of ['thr-watches', 'thr-other']) {
      fanout.openStream({
        userId: 'usr-a',
        threadId,
        handler: () => undefined,
        eventHandler: () => seen.push(threadId),
      })
    }

    await service.handle({ event: 'issue_comment', payload: COMMENT_PAYLOAD })

    await waitFor(async () => expect(await deliveryRows()).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await deliveryRows()).map((row) => row.threadId)).toEqual(['thr-watches'])
    expect(seen.sort()).toEqual(['thr-other', 'thr-watches'])
  })

  it('acks a teammate-thread subscription against that thread, not the sandbox thread', async () => {
    const { fanout, mailbox } = serviceWith({ tokens: {} })
    await seedThread({ db, id: 'thr_main', userId: 'usr-a' })
    await seedThread({ db, id: 'thr_teammate', userId: 'usr-a' })
    await db.orm.public.Thread.where({ id: 'thr_teammate' }).update({
      spawnerThreadId: 'thr_main',
    })
    const event = await seedPrEvent({ userId: 'usr-a' })
    const leaseExpiresAt = new Date(Date.now() + 60_000)
    for (const threadId of ['thr_main', 'thr_teammate']) {
      await db.orm.public.GithubPrEventDelivery.create({
        eventId: event.id,
        threadId,
        leaseExpiresAt,
      })
    }
    const router = new GithubPrStreamRouter(
      fanout,
      fakeSubscriptions() as unknown as GithubSubscriptionsService,
      new DrainStateService(),
      mailbox,
      localObservations(),
      familySandboxes as unknown as SandboxesService,
    )

    const outcome = await router.ackEvents(
      sandboxCtxFor({ userId: 'usr-a', sandboxId: 'sbx_1', threadId: 'thr_main' }),
      { threadId: 'thr_teammate', eventIds: [event.id] },
    )

    expect(outcome).toEqual({ acked: 1 })
    const rows = await deliveryRows()
    expect(rows.find((row) => row.threadId === 'thr_teammate')?.ackedAt).not.toBeNull()
    expect(rows.find((row) => row.threadId === 'thr_main')?.ackedAt).toBeNull()
  })
})
