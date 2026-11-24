import { describe, expect, it } from 'bun:test'

import { ESubscriptionActor, ESubscriptionEnd } from '@dltech/atlas-core'

import type { ControlTx } from '../src/port'
import { endSubscriptionsIn } from '../src/subscription-endings'
import { subscribeIn } from '../src/subscription-ops'
import {
  MAIN,
  NOW,
  REPO,
  SESSION,
  pullRequestLease,
  recordsOf,
  setup,
  subscribe,
} from './subscription-fixtures'

const PAST = '2026-11-22T11:00:00.000Z'

const seededExpiring = async (args: {
  store: Awaited<ReturnType<typeof setup>>['store']
  deadline: string
}) =>
  await args.store.transact((tx) =>
    tx.insertSubscriptionRow({
      userId: 'user-a',
      repoFullName: 'acme/atlas',
      branch: '#7',
      threadId: MAIN,
      sessionId: SESSION,
      provider: 'github.pull-request',
      kind: 'pull-request',
      prNumber: 7,
      target: { repo: REPO, number: 7 },
      label: 'acme/atlas#7',
      createdBy: ESubscriptionActor.Agent,
      events: [],
      expiresAt: args.deadline,
      deadline: args.deadline,
      createdAt: NOW,
    }),
  )

describe('writes that race another writer', () => {
  it('inserts a fresh row when the update finds its row gone', async () => {
    const { store, plane } = await setup()
    const first = await subscribe({ plane, events: ['check_run'] })

    const result = await store.transact(async (tx) => {
      const held = await tx.findSubscription({
        userId: 'user-a',
        repoFullName: 'acme/atlas',
        branch: '#7',
        threadId: MAIN,
      })
      if (held === undefined) throw new Error('the row was not written')
      await tx.deleteSubscriptionRow(held.subscriptionId)
      const stale = Object.create(tx) as ControlTx
      let reads = 0
      stale.findSubscription = async (key) => {
        reads += 1
        return reads === 1 ? held : tx.findSubscription(key)
      }
      stale.updateSubscriptionRow = async () => false
      const session = await tx.readSession({ sessionId: SESSION })
      if (session === undefined) throw new Error('the session was not written')
      return subscribeIn({
        tx: stale,
        session,
        threadId: MAIN,
        provider: 'github.pull-request',
        target: { repo: REPO, number: 7 },
        label: 'acme/atlas#7',
        events: ['push'],
        lease: pullRequestLease(7),
        by: ESubscriptionActor.Agent,
        at: NOW,
      })
    })

    expect([result.existed, result.updated]).toEqual([false, false])
    expect(result.subscription.id).not.toBe(first.subscription.id)
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toEqual([result.subscription])
  })

  it('keeps a row renewed between its selection and the sweep', async () => {
    const { store, plane } = await setup()
    const expired = await seededExpiring({ store, deadline: PAST })
    const rows = [{ subscriptionId: expired.row.subscriptionId, threadId: MAIN }]
    await subscribe({ plane })

    const ended = await store.transact((tx) =>
      endSubscriptionsIn({
        tx,
        rows,
        by: ESubscriptionActor.Clock,
        reason: ESubscriptionEnd.Expired,
        at: NOW,
        endedBefore: NOW,
      }),
    )

    expect(ended).toBe(0)
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toHaveLength(1)
    expect(await recordsOf({ plane })).toHaveLength(1)
  })

  it('ends a row that is still expired when the sweep deletes it', async () => {
    const { store, plane } = await setup()
    const expired = await seededExpiring({ store, deadline: PAST })

    const ended = await store.transact((tx) =>
      endSubscriptionsIn({
        tx,
        rows: [{ subscriptionId: expired.row.subscriptionId, threadId: MAIN }],
        by: ESubscriptionActor.Clock,
        reason: ESubscriptionEnd.Expired,
        at: NOW,
        endedBefore: NOW,
      }),
    )

    expect(ended).toBe(1)
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toEqual([])
    expect(await recordsOf({ plane })).toMatchObject([
      {
        type: 'subscription-ended',
        subscriptionId: expired.row.subscriptionId,
        reason: ESubscriptionEnd.Expired,
        by: ESubscriptionActor.Clock,
      },
    ])
  })
})
