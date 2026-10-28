import { describe, expect, it } from 'bun:test'

import {
  ESubscriptionActorWire,
  ESubscriptionStatusWire,
  type SubscriptionsWire,
} from '@dltech/atlas-wire/web'

import { EClientFrame, EClientRequest, EServeFrame } from '../channel-wire'
import {
  listSubscriptions,
  setSubscriptionStatus,
  SUBSCRIPTIONS_TOO_OLD,
  subscribeTo,
  unsubscribeFrom,
} from '../subscription-tools'

import { readied, THREAD } from './remote-channel-fixture'

const lastRequest = (attached: ReturnType<typeof readied>) => {
  const frame = attached.live().sent.at(-1)
  if (frame === undefined || frame.kind !== EClientFrame.Request) throw new Error('no request sent')
  return frame
}

const set: SubscriptionsWire = {
  subscriptions: [
    {
      id: 'sub_1',
      provider: 'github.pull-request',
      target: { repo: 'github.com/o/r', number: 1 },
      label: 'o/r#1',
      threadId: THREAD,
      createdBy: ESubscriptionActorWire.Agent,
      status: ESubscriptionStatusWire.Active,
      createdAt: '2026-10-28T00:00:00.000Z',
      held: 0,
    },
  ],
  providers: [],
}

describe('the subscription channel', () => {
  it('delivers a pushed subscriptions frame to listeners', () => {
    const attached = readied()
    const seen: SubscriptionsWire[] = []
    attached.channel.onSubscriptions((pushed) => seen.push(pushed))

    attached.receive({ kind: EServeFrame.Subscriptions, ...set })

    expect(seen).toEqual([set])
  })

  it('lists over the wire and parses the reply', async () => {
    const attached = readied()
    const listed = listSubscriptions({ channel: attached.channel })
    const request = lastRequest(attached)
    expect(request.op).toBe(EClientRequest.ListSubscriptions)

    attached.receive({ kind: EServeFrame.Reply, replyTo: request.id, ok: true, data: set })

    expect(await listed).toEqual(set)
  })

  it('reads an empty answer when the serve refuses the list', async () => {
    const attached = readied()
    const listed = listSubscriptions({ channel: attached.channel })
    attached.receive({
      kind: EServeFrame.Reply,
      replyTo: lastRequest(attached).id,
      ok: false,
      data: { message: 'unknown op' },
    })

    expect(await listed).toBeNull()
  })

  it('sends subscribe params and returns the parsed outcome', async () => {
    const attached = readied()
    const done = subscribeTo({
      channel: attached.channel,
      threadId: THREAD,
      provider: 'github.pull-request',
      input: 'o/r#1',
    })
    const request = lastRequest(attached)
    expect(request).toMatchObject({
      op: EClientRequest.Subscribe,
      params: { threadId: THREAD, provider: 'github.pull-request', input: 'o/r#1' },
    })

    attached.receive({
      kind: EServeFrame.Reply,
      replyTo: request.id,
      ok: true,
      data: { ok: false, error: 'no such pull' },
    })

    expect(await done).toEqual({ ok: false, error: 'no such pull' })
  })

  it('sends a status change and an unsubscribe', async () => {
    const attached = readied()
    const paused = setSubscriptionStatus({
      channel: attached.channel,
      subscriptionId: 'sub_1',
      status: ESubscriptionStatusWire.Paused,
    })
    const pause = lastRequest(attached)
    expect(pause).toMatchObject({
      op: EClientRequest.SetSubscriptionStatus,
      params: { subscriptionId: 'sub_1', status: 'paused' },
    })
    attached.receive({ kind: EServeFrame.Reply, replyTo: pause.id, ok: true, data: { ok: true } })
    expect(await paused).toEqual({ ok: true })

    const removed = unsubscribeFrom({ channel: attached.channel, subscriptionId: 'sub_1' })
    const remove = lastRequest(attached)
    expect(remove).toMatchObject({
      op: EClientRequest.Unsubscribe,
      params: { subscriptionId: 'sub_1' },
    })
    attached.receive({ kind: EServeFrame.Reply, replyTo: remove.id, ok: true, data: { ok: true } })
    expect(await removed).toEqual({ ok: true })
  })

  it('answers a refused mutation with the too-old error instead of throwing', async () => {
    const attached = readied()
    const done = unsubscribeFrom({ channel: attached.channel, subscriptionId: 'sub_1' })
    attached.receive({
      kind: EServeFrame.Reply,
      replyTo: lastRequest(attached).id,
      ok: false,
      data: { message: 'unknown op' },
    })

    expect(await done).toEqual({ ok: false, error: SUBSCRIPTIONS_TOO_OLD })
  })
})
