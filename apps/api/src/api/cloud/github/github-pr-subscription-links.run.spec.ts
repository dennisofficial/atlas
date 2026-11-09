import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { db } from '@dltech/atlas-db'

import { ensureUsers, seedRepoHook, seedSubscription } from '../../../../test/github-seed'
import { seedEventRow, seedThreadRow } from '../../../../test/session-seed'
import { GithubSubscriptionsService } from './github-subscriptions.service'
import { GithubPrSubscriptionLinks } from './github-pr-subscription-links'

const THREAD = 'thr-1'
const USER = 'usr-1'

const runCreatedEvent = (target: Record<string, unknown>) => ({
  type: 'subscription-created',
  body: JSON.stringify({
    type: 'subscription-created',
    subscriptionId: 'sub_run_1',
    provider: 'github.workflow-run',
    target,
    label: 'compai/app run',
    createdBy: 'agent',
  }),
})

const runEndedEvent = () => ({
  type: 'subscription-ended',
  body: JSON.stringify({
    type: 'subscription-ended',
    subscriptionId: 'sub_run_1',
    by: 'provider',
    reason: 'completed',
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

describe('GithubPrSubscriptionLinks workflow runs', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers(USER)
    await seedThreadRow({ id: THREAD, userId: USER })
  })

  it('writes a kind=workflow-run row whose branch carries a pinned run id', async () => {
    const event = runCreatedEvent({ kind: 'run', repo: 'github.com/compai/app', runId: 9001 })
    await seedEventRow({
      threadId: THREAD,
      seq: 1,
      type: event.type,
      body: event.body,
      userId: USER,
    })

    await serviceWith().syncFromEvents({ userId: USER, threadId: THREAD, events: [event] })

    const rows = await linkRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: USER,
      repoFullName: 'compai/app',
      branch: '#run:9001',
      kind: 'workflow-run',
      prNumber: null,
      pollBacked: true,
      threadId: THREAD,
    })
  })

  it('writes a workflow selector into the branch column', async () => {
    const event = runCreatedEvent({
      kind: 'selector',
      repo: 'github.com/compai/app',
      workflow: 'ci.yml',
      branch: 'main',
    })
    await seedEventRow({
      threadId: THREAD,
      seq: 1,
      type: event.type,
      body: event.body,
      userId: USER,
    })

    await serviceWith().syncFromEvents({ userId: USER, threadId: THREAD, events: [event] })

    const rows = await linkRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.branch).toBe('#workflow:ci.yml@main')
  })

  it('leaves the repo hook alone for a run link', async () => {
    await seedRepoHook({ repoFullName: 'compai/app', idleSince: new Date() })
    const event = runCreatedEvent({ kind: 'run', repo: 'github.com/compai/app', runId: 9001 })

    await serviceWith().syncFromEvents({ userId: USER, threadId: THREAD, events: [event] })

    const hook = await db.orm.public.GithubRepoHook.where({ repoFullName: 'compai/app' }).first()
    expect(hook?.idleSince).not.toBeNull()
  })

  it('a subscription-ended event removes the workflow-run row', async () => {
    const created = runCreatedEvent({ kind: 'run', repo: 'github.com/compai/app', runId: 9001 })
    await seedEventRow({
      threadId: THREAD,
      seq: 1,
      type: created.type,
      body: created.body,
      userId: USER,
    })
    await serviceWith().syncFromEvents({ userId: USER, threadId: THREAD, events: [created] })
    expect(await linkRows()).toHaveLength(1)

    await serviceWith().syncFromEvents({
      userId: USER,
      threadId: THREAD,
      events: [runEndedEvent()],
    })

    expect(await linkRows()).toHaveLength(0)
  })
})
