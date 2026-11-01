import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { db } from '@dltech/atlas-db'
import type { AnyTask } from '@trigger.dev/sdk'

import { JobDispatcher, type JobDispatch } from '../../../_core/ports/job-dispatcher'
import { PrSubscriptionLinks } from '../../../_core/ports/pr-subscription-links'
import { seedSubscription } from '../../../../test/github-seed'
import { seedEventRow, seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { inertSignals } from './thread-signals.fixture'
import { ThreadArchiveService } from './thread-archive.service'

class FakeDispatcher extends JobDispatcher {
  override async dispatch<TTask extends AnyTask>(
    _args: JobDispatch<TTask>,
  ): Promise<{ runId: string }> {
    return { runId: 'run_1' }
  }
}

class FakeLinks extends PrSubscriptionLinks {
  readonly ended: { userId: string; threadIds: readonly string[] }[] = []

  override async syncFromEvents(): Promise<void> {}

  override async endForThreads(args: {
    userId: string
    threadIds: readonly string[]
  }): Promise<void> {
    this.ended.push({ userId: args.userId, threadIds: args.threadIds })
  }
}

const PR_TARGET = { repo: 'github.com/compai/app', number: 42 }

async function seedPrSubscriptionEvent(args: {
  threadId: string
  subscriptionId: string
}): Promise<void> {
  await seedEventRow({
    threadId: args.threadId,
    seq: 1,
    type: 'subscription-created',
    body: JSON.stringify({
      type: 'subscription-created',
      subscriptionId: args.subscriptionId,
      provider: 'github.pull-request',
      target: PR_TARGET,
      label: 'compai/app#42',
      createdBy: 'agent',
    }),
  })
  await db.orm.public.Thread.where({ id: args.threadId }).update({ head: 1 })
}

describe('ThreadArchiveService subscription teardown', () => {
  useTestDatabase()
  let links: FakeLinks
  let service: ThreadArchiveService

  beforeEach(async () => {
    await seedUsers(USER_A)
    links = new FakeLinks()
    service = new ThreadArchiveService(new FakeDispatcher(), inertSignals(), links)
  })

  it('appends subscription-ended and drops the wake link when archiving a subscribed thread', async () => {
    await seedThreadRow({ id: 'thr_1' })
    await seedPrSubscriptionEvent({ threadId: 'thr_1', subscriptionId: 'sub_conv_1' })
    await seedSubscription({ userId: USER_A, threadId: 'thr_1', branch: '#42' })

    await service.setArchived({ userId: USER_A, threadId: 'thr_1', archived: true })

    const ended = await db.orm.public.Event.where({
      threadId: 'thr_1',
      type: 'subscription-ended',
    }).all()
    expect(ended).toHaveLength(1)
    const body = JSON.parse(ended[0]?.body ?? '{}') as Record<string, unknown>
    expect(body.subscriptionId).toBe('sub_conv_1')
    expect(body.reason).toBe('archived')
    expect(links.ended).toEqual([{ userId: USER_A, threadIds: ['thr_1'] }])
  })

  it('ends subscriptions on every thread of the session, sub-agents included', async () => {
    await seedThreadRow({ id: 'thr_main' })
    await seedThreadRow({ id: 'thr_sub', sessionId: 'ses_thr_main' })
    await seedPrSubscriptionEvent({ threadId: 'thr_sub', subscriptionId: 'sub_conv_2' })

    await service.setArchived({ userId: USER_A, threadId: 'thr_main', archived: true })

    const ended = await db.orm.public.Event.where({ type: 'subscription-ended' }).all()
    expect(ended).toHaveLength(1)
    expect(ended[0]?.threadId).toBe('thr_sub')
    expect(links.ended[0]?.threadIds).toEqual(expect.arrayContaining(['thr_main', 'thr_sub']))
  })

  it('unarchiving ends nothing and dispatches nothing', async () => {
    await seedThreadRow({ id: 'thr_1', archivedAt: new Date() })

    await service.setArchived({ userId: USER_A, threadId: 'thr_1', archived: false })

    expect(await db.orm.public.Event.where({ type: 'subscription-ended' }).all()).toHaveLength(0)
    expect(links.ended).toHaveLength(0)
  })
})
