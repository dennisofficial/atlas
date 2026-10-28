import { describe, expect, it } from 'bun:test'

import { ESubscriptionActor, ESubscriptionStatus } from '@dltech/atlas-core'

import { QUIET_WINDOW_MS } from '../delivery-buffer'
import { EOccurrenceUrgency } from '../provider'
import { CHILD, MAIN, note, registryOf, subscribeTo } from './registry-fixture'

const unwrap = async (pending: ReturnType<typeof subscribeTo>) => {
  const outcome = await pending
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome
}

describe('SubscriptionRegistry', () => {
  it('appends subscription-created to the owner’s log and starts the provider', async () => {
    const fixture = registryOf()
    const { subscription, existed } = await unwrap(subscribeTo(fixture, 'a/b#1'))

    expect(existed).toBe(false)
    expect(subscription).toMatchObject({ id: 'sub-1', threadId: MAIN, label: 'fake a/b#1' })
    expect(fixture.log.ofType('subscription-created', MAIN)).toHaveLength(1)
    expect(fixture.fake.started).toEqual(['sub-1'])
    expect(fixture.registry.list().map((entry) => entry.id)).toEqual(['sub-1'])
  })

  it('answers an unknown provider with the known kinds', async () => {
    const fixture = registryOf()
    const outcome = await fixture.registry.subscribe({
      threadId: MAIN,
      provider: 'nope',
      input: 'x',
      projectDirectory: '/repo',
      by: ESubscriptionActor.Agent,
    })
    expect(outcome).toEqual({
      ok: false,
      error: 'Unknown subscription provider "nope". Available: fake.pr.',
    })
  })

  it('passes a provider resolve error through and records nothing', async () => {
    const fixture = registryOf()
    const outcome = await subscribeTo(fixture, 'bad-input')
    expect(outcome).toEqual({ ok: false, error: 'cannot resolve "bad-input"' })
    expect(fixture.log.stored).toEqual([])
  })

  it('owns a subagent’s subscription on the parent thread', async () => {
    const fixture = registryOf({ parents: new Map([[CHILD, MAIN]]) })
    const { subscription } = await unwrap(subscribeTo(fixture, 'a/b#1', CHILD))
    expect(subscription.threadId).toBe(MAIN)
    expect(fixture.log.ofType('subscription-created', MAIN)).toHaveLength(1)
    expect(fixture.log.ofType('subscription-created', CHILD)).toHaveLength(0)
  })

  it('returns the existing subscription for a duplicate subscribe', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1'))
    const again = await unwrap(subscribeTo(fixture, 'a/b#1'))
    expect(again.existed).toBe(true)
    expect(again.subscription.id).toBe('sub-1')
    expect(fixture.log.ofType('subscription-created')).toHaveLength(1)
  })

  it('resumes a paused subscription on a duplicate subscribe', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1'))
    await fixture.registry.setStatus({
      subscriptionId: 'sub-1',
      status: ESubscriptionStatus.Paused,
      by: ESubscriptionActor.Operator,
    })
    const again = await unwrap(subscribeTo(fixture, 'a/b#1'))
    expect(again.existed).toBe(true)
    expect(again.subscription.status).toBe(ESubscriptionStatus.Active)
    expect(fixture.fake.started).toEqual(['sub-1', 'sub-1'])
  })

  it('pause stops the provider and resume restarts it', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1'))

    await fixture.registry.setStatus({
      subscriptionId: 'sub-1',
      status: ESubscriptionStatus.Paused,
      by: ESubscriptionActor.Operator,
    })
    expect(fixture.fake.stopped).toEqual(['sub-1'])
    expect(fixture.log.ofType('subscription-changed')).toHaveLength(1)

    await fixture.registry.setStatus({
      subscriptionId: 'sub-1',
      status: ESubscriptionStatus.Active,
      by: ESubscriptionActor.Operator,
    })
    expect(fixture.fake.started).toEqual(['sub-1', 'sub-1'])
  })

  it('unsubscribe ends it, stops the provider and drops what was queued', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1'))
    fixture.fake.emit({
      id: 'sub-1',
      occurrence: { key: 'a', urgency: EOccurrenceUrgency.Now, draft: note('a') },
    })

    expect(
      await fixture.registry.unsubscribe({ subscriptionId: 'sub-1', by: ESubscriptionActor.Agent }),
    ).toBe(true)
    expect(fixture.fake.stopped).toEqual(['sub-1'])
    expect(fixture.log.ofType('subscription-ended')).toHaveLength(1)
    expect(fixture.registry.list()).toEqual([])
    const batch = await fixture.registry.intakeSource.prepare({ threadId: MAIN })
    expect(batch.drafts).toEqual([])
    expect(
      await fixture.registry.unsubscribe({ subscriptionId: 'sub-1', by: ESubscriptionActor.Agent }),
    ).toBe(false)
  })

  it('ends a subscription at its expiry', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1', MAIN, new Date(60_000).toISOString()))
    fixture.clock.advance(59_999)
    expect(fixture.registry.list()).toHaveLength(1)

    fixture.clock.advance(1)
    await fixture.registry.unsubscribe({ subscriptionId: 'none', by: ESubscriptionActor.Agent })
    expect(fixture.registry.list()).toEqual([])
    expect(fixture.log.ofType('subscription-ended')).toMatchObject([
      { reason: 'expired', by: 'clock' },
    ])
    expect(fixture.fake.stopped).toEqual(['sub-1'])
  })

  it('restores state from the log after a rewind', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1'))
    await unwrap(subscribeTo(fixture, 'a/b#2'))
    expect(fixture.registry.list()).toHaveLength(2)

    fixture.log.truncate({ threadId: MAIN, toSeq: 1 })
    await fixture.registry.reload({ threadId: MAIN })

    expect(fixture.registry.list().map((entry) => entry.id)).toEqual(['sub-1'])
    expect(fixture.fake.stopped).toContain('sub-2')
  })

  it('loads a thread’s persisted subscriptions and starts their providers', async () => {
    const first = registryOf()
    await unwrap(subscribeTo(first, 'a/b#1'))

    const second = registryOf()
    second.log.stored.push(...first.log.stored)
    await second.registry.load({ threadId: MAIN })

    expect(second.registry.list().map((entry) => entry.id)).toEqual(['sub-1'])
    expect(second.fake.started).toEqual(['sub-1'])
  })

  it('wakes intake once with a batched set', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1'))
    const wakes: number[] = []
    fixture.registry.intakeSource.subscribe(() => wakes.push(1))

    fixture.fake.emit({
      id: 'sub-1',
      occurrence: { key: 'ci', urgency: EOccurrenceUrgency.Batch, draft: note('ci') },
    })
    fixture.fake.emit({
      id: 'sub-1',
      occurrence: { key: 'review', urgency: EOccurrenceUrgency.Batch, draft: note('review') },
    })
    expect((await fixture.registry.intakeSource.prepare({ threadId: MAIN })).wakesTurn).toBe(false)
    expect(fixture.registry.list()[0]?.held).toBe(2)

    fixture.clock.advance(QUIET_WINDOW_MS)
    expect(fixture.registry.intakeSource.threadsAwaitingInput()).toEqual([MAIN])

    const batch = await fixture.registry.intakeSource.prepare({ threadId: MAIN })
    expect(batch.wakesTurn).toBe(true)
    expect(batch.drafts).toEqual([note('ci'), note('review')])
    batch.acknowledge()
    expect(fixture.registry.intakeSource.threadsAwaitingInput()).toEqual([])
    expect((await fixture.registry.intakeSource.prepare({ threadId: MAIN })).wakesTurn).toBe(false)
  })

  const emitFinal = (fixture: ReturnType<typeof registryOf>) =>
    fixture.fake.emit({
      id: 'sub-1',
      occurrence: {
        key: 'merged',
        urgency: EOccurrenceUrgency.Now,
        ends: true,
        draft: note('merged'),
      },
    })

  const flushed = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  it('ends the subscription as completed only after the final delivery is acknowledged', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1'))
    emitFinal(fixture)
    await flushed()
    expect(fixture.log.ofType('subscription-ended')).toEqual([])

    const batch = await fixture.registry.intakeSource.prepare({ threadId: MAIN })
    expect(batch.drafts).toEqual([note('merged')])
    await fixture.log.append({ threadId: MAIN, drafts: batch.drafts })
    batch.acknowledge()
    await flushed()

    expect(fixture.log.stored.map((event) => event.type)).toEqual([
      'subscription-created',
      'user-said',
      'subscription-ended',
    ])
    expect(fixture.log.ofType('subscription-ended')).toMatchObject([
      { reason: 'completed', by: 'provider' },
    ])
    expect(fixture.registry.list()).toEqual([])
  })

  it('stops the provider and holds back later occurrences while the final delivery is pending', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1'))
    emitFinal(fixture)
    fixture.fake.emit({
      id: 'sub-1',
      occurrence: { key: 'late', urgency: EOccurrenceUrgency.Now, draft: note('late') },
    })

    const batch = await fixture.registry.intakeSource.prepare({ threadId: MAIN })
    expect(batch.drafts).toEqual([note('merged')])
  })

  it('ends it as completed when the queue is discarded before the batch is taken', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1'))
    emitFinal(fixture)
    await fixture.registry.setStatus({
      subscriptionId: 'sub-1',
      status: ESubscriptionStatus.Paused,
      by: ESubscriptionActor.Operator,
    })
    await flushed()

    expect(fixture.log.ofType('subscription-ended')).toMatchObject([{ reason: 'completed' }])
    expect(fixture.registry.intakeSource.threadsAwaitingInput()).toEqual([])
  })

  it('ends it as completed when the registry is disposed before the batch is taken', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1'))
    emitFinal(fixture)
    fixture.registry.dispose()
    await flushed()

    expect(fixture.log.ofType('subscription-ended')).toMatchObject([{ reason: 'completed' }])
  })

  it('drops occurrences from a paused subscription', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1'))
    await fixture.registry.setStatus({
      subscriptionId: 'sub-1',
      status: ESubscriptionStatus.Paused,
      by: ESubscriptionActor.Operator,
    })
    fixture.fake.emit({
      id: 'sub-1',
      occurrence: { key: 'a', urgency: EOccurrenceUrgency.Now, draft: note('a') },
    })
    expect(fixture.registry.intakeSource.threadsAwaitingInput()).toEqual([])
  })

  it('bumps its version and notifies on change', async () => {
    const fixture = registryOf()
    const before = fixture.registry.version()
    let heard = 0
    fixture.registry.onChange(() => heard++)
    await unwrap(subscribeTo(fixture, 'a/b#1'))
    expect(fixture.registry.version()).toBeGreaterThan(before)
    expect(heard).toBeGreaterThan(0)
  })

  it('dispose stops every provider and cancels timers', async () => {
    const fixture = registryOf()
    await unwrap(subscribeTo(fixture, 'a/b#1', MAIN, new Date(60_000).toISOString()))
    fixture.registry.dispose()
    expect(fixture.fake.stopped).toEqual(['sub-1'])
    expect(fixture.clock.pending()).toBe(0)
  })
})
