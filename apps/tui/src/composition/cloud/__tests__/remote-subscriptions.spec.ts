import { describe, expect, it } from 'bun:test'

import { ESubscriptionActor, ESubscriptionStatus, toThreadId } from '@dltech/atlas-core'
import { EClientRequest, RemoteRequestFailed } from '@dltech/atlas-client/channel'
import {
  ESubscriptionActorWire,
  ESubscriptionStatusWire,
  type SubscriptionsWire,
} from '@dltech/atlas-wire'

import { RemoteSubscriptionRegistry } from '../remote-subscriptions'

const THREAD = toThreadId('brn_cloud')

const wireSet = (held = 0): SubscriptionsWire => ({
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
      held,
    },
  ],
  providers: [{ kind: 'github.pull-request', summary: 'Pull requests', targetHint: '#n' }],
})

type Answer = (request: { op: EClientRequest; params: unknown }) => unknown

const fakeChannel = (answer: Answer) => {
  const pushes = new Set<(set: SubscriptionsWire) => void>()
  type Ready = { turnInFlight: boolean }
  const readies = new Set<(ready: Ready) => void>()
  const requests: { op: EClientRequest; params: unknown }[] = []
  const channel = {
    request: async (request: { op: EClientRequest; params: unknown }) => {
      requests.push(request)
      return answer(request)
    },
    onSubscriptions: (listener: (set: SubscriptionsWire) => void) => {
      pushes.add(listener)
      return () => void pushes.delete(listener)
    },
    onReload: () => () => undefined,
    onReady: (listener: (ready: Ready) => void) => {
      readies.add(listener)
      return () => void readies.delete(listener)
    },
  }
  return {
    channel,
    requests,
    push: (set: SubscriptionsWire) => {
      for (const listener of [...pushes]) listener(set)
    },
    ready: () => {
      for (const listener of [...readies]) listener({ turnInFlight: false })
    },
  }
}

const refusal = () =>
  new RemoteRequestFailed({ op: EClientRequest.ListSubscriptions, data: { message: 'unknown op' } })

describe('RemoteSubscriptionRegistry', () => {
  it('reads the listed set on attach and maps it to views', async () => {
    const fake = fakeChannel(() => wireSet(2))
    const registry = new RemoteSubscriptionRegistry(fake.channel)
    await Bun.sleep(0)

    expect(registry.list()).toHaveLength(1)
    expect(registry.list()[0]).toMatchObject({
      id: 'sub_1',
      held: 2,
      createdBy: ESubscriptionActor.Agent,
      status: ESubscriptionStatus.Active,
    })
    expect(registry.providers()[0]?.kind).toBe('github.pull-request')
  })

  it('takes a pushed set, bumps the version and tells listeners once per change', async () => {
    const fake = fakeChannel(() => ({ subscriptions: [], providers: [] }))
    const registry = new RemoteSubscriptionRegistry(fake.channel)
    await Bun.sleep(0)
    let fired = 0
    registry.onChange(() => void (fired += 1))
    const before = registry.version()

    fake.push(wireSet())
    fake.push(wireSet())

    expect(registry.list()).toHaveLength(1)
    expect(registry.version()).toBe(before + 1)
    expect(fired).toBe(1)
  })

  it('re-asks the serve when the channel is ready again', async () => {
    let answered = wireSet(0)
    const fake = fakeChannel(() => answered)
    const registry = new RemoteSubscriptionRegistry(fake.channel)
    await Bun.sleep(0)

    answered = wireSet(3)
    fake.ready()
    await Bun.sleep(0)

    expect(registry.list()[0]?.held).toBe(3)
  })

  it('holds an empty set while an old serve refuses the list', async () => {
    const fake = fakeChannel(() => {
      throw refusal()
    })
    const registry = new RemoteSubscriptionRegistry(fake.channel)
    await Bun.sleep(0)

    expect(registry.list()).toEqual([])
  })

  it('subscribes over the channel and maps the outcome', async () => {
    const fake = fakeChannel(({ op }) =>
      op === EClientRequest.Subscribe
        ? { ok: true, existed: true, subscription: wireSet().subscriptions[0] }
        : { subscriptions: [], providers: [] },
    )
    const registry = new RemoteSubscriptionRegistry(fake.channel)

    const outcome = await registry.subscribe({
      threadId: THREAD,
      provider: 'github.pull-request',
      input: 'o/r#1',
      projectDirectory: '/ignored',
      by: ESubscriptionActor.Operator,
    })

    expect(outcome.ok && outcome.existed).toBe(true)
    expect(fake.requests.at(-1)).toEqual({
      op: EClientRequest.Subscribe,
      params: { threadId: THREAD, provider: 'github.pull-request', input: 'o/r#1' },
    })
  })

  it('returns the too-old error when the serve refuses a mutation', async () => {
    const fake = fakeChannel(({ op }) => {
      if (op === EClientRequest.Subscribe) throw refusal()
      return { subscriptions: [], providers: [] }
    })
    const registry = new RemoteSubscriptionRegistry(fake.channel)

    const outcome = await registry.subscribe({
      threadId: THREAD,
      provider: 'github.pull-request',
      input: 'o/r#1',
      projectDirectory: '/ignored',
      by: ESubscriptionActor.Operator,
    })

    expect(outcome).toEqual({
      ok: false,
      error: "This session's Atlas is too old to manage subscriptions",
    })
  })

  it('sends status changes and removals and reports the answer', async () => {
    const fake = fakeChannel(({ op }) =>
      op === EClientRequest.Unsubscribe
        ? { ok: false, error: 'No such subscription' }
        : op === EClientRequest.SetSubscriptionStatus
          ? { ok: true }
          : { subscriptions: [], providers: [] },
    )
    const registry = new RemoteSubscriptionRegistry(fake.channel)

    const paused = await registry.setStatus({
      subscriptionId: 'sub_1',
      status: ESubscriptionStatus.Paused,
      by: ESubscriptionActor.Operator,
    })
    const removed = await registry.unsubscribe({
      subscriptionId: 'sub_1',
      by: ESubscriptionActor.Operator,
    })

    expect(paused).toBe(true)
    expect(removed).toBe(false)
    expect(
      fake.requests.find((r) => r.op === EClientRequest.SetSubscriptionStatus)?.params,
    ).toEqual({
      subscriptionId: 'sub_1',
      status: 'paused',
    })
  })
})
