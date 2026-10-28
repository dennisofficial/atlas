import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedEventRow, seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { inertSignals } from './thread-signals.fixture'
import {
  activePullRequestSubscription,
  threadSubscriptions,
  threadsSubscriptions,
} from './thread-subscriptions'
import { ThreadsService } from './threads.service'

const TARGET = { repo: 'github.com/compai/app', number: 42 }

const created = (args: { id: string; target?: unknown }) =>
  JSON.stringify({
    type: 'subscription-created',
    subscriptionId: args.id,
    provider: 'github.pull-request',
    target: args.target ?? TARGET,
    label: 'compai/app#42',
    createdBy: 'agent',
  })

const changed = (args: { id: string; status: string }) =>
  JSON.stringify({
    type: 'subscription-changed',
    subscriptionId: args.id,
    status: args.status,
    by: 'operator',
  })

const ended = (id: string) =>
  JSON.stringify({
    type: 'subscription-ended',
    subscriptionId: id,
    reason: 'unsubscribed',
    by: 'agent',
  })

describe('thread subscriptions', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
  })

  it('folds created, changed and ended events into the live set', async () => {
    await seedThreadRow({ id: 'thr-a' })
    await seedEventRow({
      threadId: 'thr-a',
      seq: 1,
      type: 'subscription-created',
      body: created({ id: 's1' }),
    })
    await seedEventRow({
      threadId: 'thr-a',
      seq: 2,
      type: 'subscription-created',
      body: created({ id: 's2', target: { repo: 'github.com/compai/app', number: 7 } }),
    })
    await seedEventRow({
      threadId: 'thr-a',
      seq: 3,
      type: 'subscription-changed',
      body: changed({ id: 's1', status: 'paused' }),
    })
    await seedEventRow({ threadId: 'thr-a', seq: 4, type: 'subscription-ended', body: ended('s2') })

    const live = await threadSubscriptions({ reader: db, threadId: 'thr-a' })

    expect(live.map(({ id, status }) => ({ id, status }))).toEqual([{ id: 's1', status: 'paused' }])
  })

  it('inherits a reference fork parent up to the fork point only', async () => {
    await seedThreadRow({ id: 'parent' })
    await seedEventRow({
      threadId: 'parent',
      seq: 1,
      type: 'subscription-created',
      body: created({ id: 's1' }),
    })
    await seedEventRow({
      threadId: 'parent',
      seq: 2,
      type: 'subscription-ended',
      body: ended('s1'),
    })
    await seedThreadRow({
      id: 'child',
      parentThreadId: 'parent',
      forkSeq: 1,
      forkMode: 'reference',
    })
    await seedThreadRow({ id: 'late', parentThreadId: 'parent', forkSeq: 2, forkMode: 'reference' })

    const all = await threadsSubscriptions({ reader: db, threadIds: ['child', 'late', 'parent'] })

    expect(all.get('child')?.map((entry) => entry.id)).toEqual(['s1'])
    expect(all.get('late')).toEqual([])
    expect(all.get('parent')).toEqual([])
  })

  it('does not inherit from a copy fork', async () => {
    await seedThreadRow({ id: 'parent' })
    await seedEventRow({
      threadId: 'parent',
      seq: 1,
      type: 'subscription-created',
      body: created({ id: 's1' }),
    })
    await seedThreadRow({ id: 'copy', parentThreadId: 'parent', forkSeq: 1, forkMode: 'copy' })

    expect(await threadSubscriptions({ reader: db, threadId: 'copy' })).toEqual([])
  })

  it('matches only an active github.pull-request subscription on the exact target', async () => {
    await seedThreadRow({ id: 'thr-a' })
    await seedEventRow({
      threadId: 'thr-a',
      seq: 1,
      type: 'subscription-created',
      body: created({ id: 's1' }),
    })
    const subscriptions = await threadSubscriptions({ reader: db, threadId: 'thr-a' })

    expect(
      activePullRequestSubscription({ subscriptions, repoFullName: 'compai/app', prNumber: 42 })
        ?.id,
    ).toBe('s1')
    expect(
      activePullRequestSubscription({ subscriptions, repoFullName: 'compai/app', prNumber: 43 }),
    ).toBeUndefined()
    expect(
      activePullRequestSubscription({ subscriptions, repoFullName: 'compai/other', prNumber: 42 }),
    ).toBeUndefined()
    expect(
      activePullRequestSubscription({
        subscriptions: subscriptions.map((entry) => ({ ...entry, status: 'paused' })),
        repoFullName: 'compai/app',
        prNumber: 42,
      }),
    ).toBeUndefined()
  })

  it('enrichment returns subscriptions on find and list, and omits them when there are none', async () => {
    const service = new ThreadsService(inertSignals())
    const one = await service.create({ userId: USER_A, draft: { workspace: '/repo' } })
    const bare = await service.create({ userId: USER_A, draft: { workspace: '/repo' } })
    await seedEventRow({
      threadId: one.id,
      seq: 1,
      type: 'subscription-created',
      body: created({ id: 's1' }),
    })

    const found = await service.find({ userId: USER_A, threadId: one.id })
    const listed = await service.list({ userId: USER_A, project: '/repo' })

    expect(found.subscriptions).toEqual([
      { provider: 'github.pull-request', target: TARGET, status: 'active' },
    ])
    expect(listed.find((row) => row.id === one.id)?.subscriptions).toEqual(found.subscriptions!)
    expect(listed.find((row) => row.id === bare.id)?.subscriptions).toBeUndefined()
  })
})
