import { describe, expect, it } from 'bun:test'

import { ESubscriptionActor, ESubscriptionEnd } from '@dltech/atlas-core'

import { OTHER_SESSION, SESSION, recordsOf, setup, subscribe } from './subscription-fixtures'

describe('unsubscribing', () => {
  it('deletes the row and records the ending', async () => {
    const { plane } = await setup()
    const subscribed = await subscribe({ plane })
    const result = await plane.unsubscribe({
      sessionId: SESSION,
      subscriptionId: subscribed.subscription.id,
      by: ESubscriptionActor.Operator,
      reason: ESubscriptionEnd.Unsubscribed,
    })

    expect(result).toEqual({ ended: true })
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toEqual([])
    expect(await recordsOf({ plane })).toMatchObject([
      { type: 'subscription-created' },
      {
        type: 'subscription-ended',
        subscriptionId: subscribed.subscription.id,
        reason: ESubscriptionEnd.Unsubscribed,
        by: ESubscriptionActor.Operator,
      },
    ])
  })

  it('answers ended false and records nothing for an unknown id', async () => {
    const { plane } = await setup()
    expect(
      await plane.unsubscribe({
        sessionId: SESSION,
        subscriptionId: 'missing',
        by: ESubscriptionActor.Operator,
        reason: ESubscriptionEnd.Unsubscribed,
      }),
    ).toEqual({ ended: false })
    expect(await recordsOf({ plane })).toEqual([])
  })

  it('refuses an id of another session', async () => {
    const { plane } = await setup()
    const subscribed = await subscribe({ plane })
    await expect(
      plane.unsubscribe({
        sessionId: OTHER_SESSION,
        subscriptionId: subscribed.subscription.id,
        by: ESubscriptionActor.Operator,
        reason: ESubscriptionEnd.Unsubscribed,
      }),
    ).rejects.toThrow('belongs to another session')
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toHaveLength(1)
  })

  it('ends once when two callers unsubscribe the same row together', async () => {
    const { plane } = await setup()
    const subscribed = await subscribe({ plane })
    const unsubscribe = () =>
      plane.unsubscribe({
        sessionId: SESSION,
        subscriptionId: subscribed.subscription.id,
        by: ESubscriptionActor.Operator,
        reason: ESubscriptionEnd.Unsubscribed,
      })

    const results = await Promise.all([unsubscribe(), unsubscribe()])

    expect(results.map((result) => result.ended).sort()).toEqual([false, true])
    expect(await plane.listSubscriptions({ sessionId: SESSION })).toEqual([])
    expect(await recordsOf({ plane })).toHaveLength(2)
  })
})
