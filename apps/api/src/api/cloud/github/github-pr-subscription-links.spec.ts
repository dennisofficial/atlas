import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { db } from '@dltech/atlas-db'

import { ensureUsers, seedSubscription } from '../../../../test/github-seed'
import { seedThreadRow } from '../../../../test/session-seed'
import { GithubSubscriptionsService } from './github-subscriptions.service'
import { GithubPrSubscriptionLinks } from './github-pr-subscription-links'

const THREAD = 'thr-1'
const USER = 'usr-1'

const createdEvent = (args: { repo?: string; number?: number; provider?: string } = {}) => ({
  type: 'subscription-created',
  body: JSON.stringify({
    type: 'subscription-created',
    subscriptionId: 'sub_conv_1',
    provider: args.provider ?? 'github.pull-request',
    target: { repo: args.repo ?? 'github.com/compai/app', number: args.number ?? 42 },
    label: 'compai/app#42',
    createdBy: 'agent',
  }),
})

function serviceWith(): GithubPrSubscriptionLinks {
  const subscriptions = new GithubSubscriptionsService(
    { findToken: async () => 'token' } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return new GithubPrSubscriptionLinks(subscriptions)
}

const linkRows = () => db.orm.public.GithubSubscription.where({ threadId: THREAD }).all()

describe('GithubPrSubscriptionLinks', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers(USER)
    await seedThreadRow({ id: THREAD, userId: USER })
  })

  it('creates a thread-linked GithubSubscription row for a conversation subscribe event', async () => {
    await serviceWith().syncFromEvents({
      userId: USER,
      threadId: THREAD,
      events: [createdEvent()],
    })

    const rows = await linkRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: USER,
      repoFullName: 'compai/app',
      prNumber: 42,
      branch: '#42',
      threadId: THREAD,
    })
  })

  it('upserts the shared (userId, repoFullName, branch) row instead of forking a second one', async () => {
    await seedSubscription({ userId: USER, repoFullName: 'compai/app', branch: '#42' })

    await serviceWith().syncFromEvents({
      userId: USER,
      threadId: THREAD,
      events: [createdEvent()],
    })

    const all = await db.orm.public.GithubSubscription.where({
      userId: USER,
      repoFullName: 'compai/app',
      branch: '#42',
    }).all()
    expect(all).toHaveLength(1)
    expect(all[0]?.threadId).toBe(THREAD)
  })

  it('ignores non-PR providers and malformed bodies', async () => {
    await serviceWith().syncFromEvents({
      userId: USER,
      threadId: THREAD,
      events: [
        createdEvent({ provider: 'other.provider' }),
        { type: 'subscription-created', body: 'not-json' },
        { type: 'subscription-ended', body: '{}' },
      ],
    })

    expect(await linkRows()).toHaveLength(0)
  })

  it('endForThreads deletes the link rows of archived threads', async () => {
    await serviceWith().syncFromEvents({
      userId: USER,
      threadId: THREAD,
      events: [createdEvent()],
    })
    expect(await linkRows()).toHaveLength(1)

    await serviceWith().endForThreads({
      userId: USER,
      threadIds: [THREAD],
      activeTargets: new Map(),
    })

    expect(await linkRows()).toHaveLength(0)
  })

  it('endForThreads keeps a link whose target is still active on the thread', async () => {
    await serviceWith().syncFromEvents({
      userId: USER,
      threadId: THREAD,
      events: [createdEvent()],
    })

    await serviceWith().endForThreads({
      userId: USER,
      threadIds: [THREAD],
      activeTargets: new Map([[THREAD, [{ repoFullName: 'compai/app', prNumber: 42 }]]]),
    })

    expect(await linkRows()).toHaveLength(1)
  })
})
