import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { db } from '@dltech/atlas-db'

import { ensureUsers, seedSubscription } from '../../../../test/github-seed'
import { seedEventRow, seedThreadRow } from '../../../../test/session-seed'
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
    { record: async () => undefined } as never,
  )
  return new GithubPrSubscriptionLinks(subscriptions)
}

const linkRows = () => db.orm.public.GithubSubscription.where({ threadId: THREAD }).all()

async function linkFromConversation(args: { threadId: string }): Promise<void> {
  const event = createdEvent()
  await seedEventRow({
    threadId: args.threadId,
    seq: 1,
    type: event.type,
    body: event.body,
    userId: USER,
  })
  await serviceWith().syncFromEvents({
    userId: USER,
    threadId: args.threadId,
    events: [event],
  })
}

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

  it("a conversation link does not steal another principal's row for the same pull request", async () => {
    const held = await seedSubscription({
      userId: USER,
      repoFullName: 'compai/app',
      branch: '#42',
    })

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
    expect(all).toHaveLength(2)
    const unlinked = all.find((row) => row.id === held.id)
    expect(unlinked?.threadId).toBe('')
    expect(all.some((row) => row.threadId === THREAD)).toBe(true)
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

  it('two threads linking the same pull request each keep their own row', async () => {
    await seedThreadRow({ id: 'thr-2', userId: USER })

    await serviceWith().syncFromEvents({
      userId: USER,
      threadId: THREAD,
      events: [createdEvent()],
    })
    await serviceWith().syncFromEvents({
      userId: USER,
      threadId: 'thr-2',
      events: [createdEvent()],
    })

    const all = await db.orm.public.GithubSubscription.where({
      userId: USER,
      repoFullName: 'compai/app',
      branch: '#42',
    }).all()
    expect(all).toHaveLength(2)
    expect(all.map((row) => row.threadId).sort()).toEqual([THREAD, 'thr-2'].sort())
  })

  it("a subscription-ended event deletes the thread's link row", async () => {
    await linkFromConversation({ threadId: THREAD })
    expect(await linkRows()).toHaveLength(1)

    await serviceWith().syncFromEvents({
      userId: USER,
      threadId: THREAD,
      events: [
        {
          type: 'subscription-ended',
          body: JSON.stringify({
            type: 'subscription-ended',
            subscriptionId: 'sub_conv_1',
            by: 'provider',
            reason: 'completed',
          }),
        },
      ],
    })

    expect(await linkRows()).toHaveLength(0)
  })

  it("a subscription-ended event leaves another thread's link intact", async () => {
    await seedThreadRow({ id: 'thr-2', userId: USER })
    await linkFromConversation({ threadId: THREAD })
    await linkFromConversation({ threadId: 'thr-2' })

    await serviceWith().syncFromEvents({
      userId: USER,
      threadId: THREAD,
      events: [
        {
          type: 'subscription-ended',
          body: JSON.stringify({
            type: 'subscription-ended',
            subscriptionId: 'sub_conv_1',
            by: 'provider',
            reason: 'completed',
          }),
        },
      ],
    })

    const remaining = await db.orm.public.GithubSubscription.where({
      userId: USER,
      repoFullName: 'compai/app',
      branch: '#42',
    }).all()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.threadId).toBe('thr-2')
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
