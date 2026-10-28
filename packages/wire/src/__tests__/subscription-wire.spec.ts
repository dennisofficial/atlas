import { describe, expect, it } from 'bun:test'

import {
  decodeServeFrame,
  EClientRequest,
  encodeFrame,
  EServeFrame,
  ESubscriptionActorWire,
  ESubscriptionStatusWire,
  setSubscriptionStatusParamsSchema,
  subscribeParamsSchema,
  threadIdWireSchema,
  subscriptionReplySchema,
  subscriptionsWireSchema,
  unsubscribeParamsSchema,
  type SubscriptionsWire,
} from '../index'

const set: SubscriptionsWire = {
  subscriptions: [
    {
      id: 'sub_1',
      provider: 'github.pull-request',
      target: { repo: 'github.com/dltech/atlas', number: 12 },
      label: 'dltech/atlas#12',
      threadId: threadIdWireSchema.parse('thr_1'),
      createdBy: ESubscriptionActorWire.Agent,
      status: ESubscriptionStatusWire.Active,
      expiresAt: '2026-10-29T00:00:00.000Z',
      createdAt: '2026-10-28T00:00:00.000Z',
      held: 2,
    },
  ],
  providers: [{ kind: 'github.pull-request', summary: 'Pull request events', targetHint: '#n' }],
}

describe('the subscription wire', () => {
  it('names the four ops', () => {
    expect(String(EClientRequest.ListSubscriptions)).toBe('list-subscriptions')
    expect(String(EClientRequest.Subscribe)).toBe('subscribe')
    expect(String(EClientRequest.SetSubscriptionStatus)).toBe('set-subscription-status')
    expect(String(EClientRequest.Unsubscribe)).toBe('unsubscribe')
  })

  it('round-trips a subscriptions frame', () => {
    const frame = { kind: EServeFrame.Subscriptions, ...set } as const
    expect(decodeServeFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('drops a subscriptions frame with a malformed row', () => {
    const raw = JSON.stringify({
      kind: EServeFrame.Subscriptions,
      subscriptions: [{ id: 'x' }],
      providers: [],
    })
    expect(decodeServeFrame(raw)).toBeNull()
  })

  it('refuses an unknown status and a negative held count', () => {
    const row = set.subscriptions[0]
    expect(
      subscriptionsWireSchema.safeParse({
        ...set,
        subscriptions: [{ ...row, status: 'gone' }],
      }).success,
    ).toBe(false)
    expect(
      subscriptionsWireSchema.safeParse({ ...set, subscriptions: [{ ...row, held: -1 }] }).success,
    ).toBe(false)
  })

  it('wants a thread, a provider and an input to subscribe', () => {
    expect(
      subscribeParamsSchema.safeParse({ threadId: 'thr_1', provider: 'p', input: '#1' }).success,
    ).toBe(true)
    expect(subscribeParamsSchema.safeParse({ provider: 'p', input: '#1' }).success).toBe(false)
    expect(subscribeParamsSchema.safeParse({ threadId: 'thr_1', input: '#1' }).success).toBe(false)
  })

  it('wants an id and a known status to change one', () => {
    expect(
      setSubscriptionStatusParamsSchema.safeParse({ subscriptionId: 's', status: 'paused' })
        .success,
    ).toBe(true)
    expect(
      setSubscriptionStatusParamsSchema.safeParse({ subscriptionId: 's', status: 'ended' }).success,
    ).toBe(false)
    expect(unsubscribeParamsSchema.safeParse({}).success).toBe(false)
  })

  it('parses an ok reply and a refusal', () => {
    expect(subscriptionReplySchema.parse({ ok: true })).toEqual({ ok: true })
    expect(subscriptionReplySchema.parse({ ok: false, error: 'nope' }).error).toBe('nope')
    expect(subscriptionReplySchema.safeParse({ error: 'nope' }).success).toBe(false)
  })
})
