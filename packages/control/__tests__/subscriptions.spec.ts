import { describe, expect, it } from 'bun:test'

import { ESubscriptionActor } from '@dltech/atlas-core'

import {
  CHILD,
  MAIN,
  REPO,
  SESSION,
  TTL_LATER,
  eventsOf,
  pullRequestLease,
  recordsOf,
  setup,
  subscribe,
} from './subscription-fixtures'

describe('subscribing', () => {
  it('inserts the row, posts one quiet record, and lists it', async () => {
    const { plane } = await setup()
    const result = await subscribe({ plane })

    expect(result.existed).toBe(false)
    expect(result.updated).toBe(false)
    expect(result.subscription).toMatchObject({
      threadId: MAIN,
      provider: 'github.pull-request',
      target: { repo: REPO, number: 7 },
      label: 'acme/atlas#7',
      events: [],
      createdBy: ESubscriptionActor.Agent,
      expiresAt: TTL_LATER,
    })
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toEqual([result.subscription])
    expect(await recordsOf({ plane })).toEqual([
      {
        type: 'subscription-created',
        subscriptionId: result.subscription.id,
        provider: 'github.pull-request',
        target: { repo: REPO, number: 7 },
        label: 'acme/atlas#7',
        createdBy: ESubscriptionActor.Agent,
        expiresAt: TTL_LATER,
      },
    ])
  })

  it('writes no second record for the same target and events', async () => {
    const { plane } = await setup()
    const first = await subscribe({ plane })
    const second = await subscribe({ plane })

    expect(second.existed).toBe(true)
    expect(second.updated).toBe(false)
    expect(second.subscription).toEqual(first.subscription)
    expect(await recordsOf({ plane })).toHaveLength(1)
  })

  it('updates the row and records the same id when the events change', async () => {
    const { plane } = await setup()
    const first = await subscribe({ plane })
    const second = await subscribe({ plane, events: ['check_run'] })

    expect(second.existed).toBe(true)
    expect(second.updated).toBe(true)
    expect(second.subscription.id).toBe(first.subscription.id)
    expect(second.subscription.events).toEqual(['check_run'])
    const records = await recordsOf({ plane })
    expect(records).toHaveLength(2)
    expect(records[1]).toMatchObject({
      type: 'subscription-created',
      subscriptionId: first.subscription.id,
      events: ['check_run'],
    })
  })

  it('records and announces every change when the filter returns to an earlier one', async () => {
    const { store, plane } = await setup()
    const announced = store.changesOf(SESSION).length
    const first = await subscribe({ plane, events: ['check_run'] })
    const second = await subscribe({ plane, events: ['push'] })
    const third = await subscribe({ plane, events: ['check_run'] })

    expect([second.existed, second.updated]).toEqual([true, true])
    expect([third.existed, third.updated]).toEqual([true, true])
    expect(third.subscription.id).toBe(first.subscription.id)
    expect(eventsOf(await recordsOf({ plane }))).toEqual([['check_run'], ['push'], ['check_run']])
    expect(store.changesOf(SESSION)).toHaveLength(announced + 3)
  })

  it('keeps the held filter and expiry when a repeat names neither', async () => {
    const { plane } = await setup()
    const first = await subscribe({ plane, events: ['check_run'] })
    const again = await plane.subscribe({
      sessionId: SESSION,
      threadId: MAIN,
      provider: 'github.pull-request',
      target: { repo: REPO, number: 7 },
      label: 'acme/atlas#7',
      lease: pullRequestLease(7),
      by: ESubscriptionActor.Agent,
    })

    expect(again).toEqual({ subscription: first.subscription, existed: true, updated: false })
    expect(await recordsOf({ plane })).toHaveLength(1)
  })

  it('tracks the pull request and links it to the session', async () => {
    const { store, plane } = await setup()
    await subscribe({ plane })

    expect(store.trackingTargets()).toMatchObject([
      {
        userId: 'user-a',
        kind: 'pull-request',
        repoFullName: 'acme/atlas',
        prNumber: 7,
        liveUntil: TTL_LATER,
      },
    ])
    expect(
      (await plane.readSessionView({ sessionId: SESSION, threadId: MAIN })).value.subscriptions.map(
        (subscription) => subscription.label,
      ),
    ).toEqual(['acme/atlas#7'])
  })

  it('keeps a workflow-run subscription without a pull request link', async () => {
    const { store, plane } = await setup()
    await plane.subscribe({
      sessionId: SESSION,
      threadId: MAIN,
      provider: 'github.workflow-run',
      target: { kind: 'run', repo: REPO, runId: 42 },
      label: 'acme/atlas#42',
      events: [],
      lease: { repo: REPO, subject: { kind: 'workflow-run', selector: '#run:42' } },
      by: ESubscriptionActor.Agent,
    })

    expect(store.trackingTargets()).toEqual([])
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toMatchObject([
      { provider: 'github.workflow-run', target: { kind: 'run', repo: REPO, runId: 42 } },
    ])
  })

  it('posts the record on the child thread that owns it', async () => {
    const { plane } = await setup()
    await plane.createThread({ threadId: CHILD, sessionId: SESSION })
    await subscribe({ plane, threadId: CHILD })

    expect(await recordsOf({ plane })).toEqual([])
    expect(await recordsOf({ plane, threadId: CHILD })).toHaveLength(1)
  })

  it('refuses a thread of another session', async () => {
    const { plane } = await setup()
    await expect(subscribe({ plane, threadId: 'thread-other' })).rejects.toThrow(
      'belongs to another session',
    )
  })
})
