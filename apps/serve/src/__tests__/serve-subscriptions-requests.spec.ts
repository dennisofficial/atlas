import { describe, expect, it } from 'bun:test'

import {
  ESubscriptionActor,
  ESubscriptionStatus,
  type Subscription,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  EClientFrame,
  EClientRequest,
  EServeFrame,
  encodeFrame,
  type SubscribeOutcome,
  type SubscriptionView,
} from '@dltech/atlas-harness'

import { createFrameBuffer } from '../frame-buffer'
import type { ServeSubscriptions } from '../serve-app'
import { createSessionHandlers, type SessionSocket } from '../socket-session'
import type { ServeTurnDriver } from '../turn-driver'

const threadId = 'br_subs' as ThreadId

const subscription = (over: Partial<Subscription> = {}): Subscription => ({
  id: 'sub_1',
  provider: 'github.pull-request',
  target: { repo: 'github.com/dltech/atlas', number: 12 },
  label: 'dltech/atlas#12',
  threadId,
  createdBy: ESubscriptionActor.Agent,
  status: ESubscriptionStatus.Active,
  createdAt: '2026-10-28T00:00:00.000Z',
  ...over,
})

const untouchedDriver = (): ServeTurnDriver =>
  ({
    running: () => false,
    busy: () => false,
    outcomePending: () => false,
    settled: async () => undefined,
  }) as unknown as ServeTurnDriver

const freshSocket = (): { socket: SessionSocket; sent: string[] } => {
  const sent: string[] = []
  const socket = {
    data: { helloed: false, alias: null, greeting: 0, greeted: false, held: [], bootHeld: [] },
    send: (payload: string) => {
      sent.push(payload)
    },
    close: () => undefined,
    terminate: () => undefined,
  } as unknown as SessionSocket
  return { socket, sent }
}

type Calls = { name: string; args: unknown }[]

const fakeSubscriptions = (args?: { rows?: SubscriptionView[]; outcome?: SubscribeOutcome }) => {
  const calls: Calls = []
  const rows = args?.rows ?? [{ ...subscription(), held: 1 }]
  const subscriptions: ServeSubscriptions = {
    projectDirectory: '/work/atlas',
    registry: {
      list: () => rows,
      providers: () => [
        { kind: 'github.pull-request', summary: 'Pull requests', targetHint: '#n' },
      ],
      subscribe: async (call) => {
        calls.push({ name: 'subscribe', args: call })
        return args?.outcome ?? { ok: true, subscription: subscription(), existed: false }
      },
      setStatus: async (call) => {
        calls.push({ name: 'setStatus', args: call })
        return call.subscriptionId === 'sub_1'
      },
      unsubscribe: async (call) => {
        calls.push({ name: 'unsubscribe', args: call })
        return call.subscriptionId === 'sub_1'
      },
      onChange: () => () => undefined,
    },
  }
  return { subscriptions, calls }
}

const greeted = async (subscriptions?: ServeSubscriptions) => {
  const handlers = createSessionHandlers({
    threadId,
    buffer: createFrameBuffer({ capacity: 16 }),
    inFlight: () => [],
    liveStepId: () => null,
    driver: untouchedDriver(),
    files: { list: async () => [] },
    refusal: () => null,
    log: () => undefined,
    ...(subscriptions === undefined ? {} : { subscriptions }),
  })
  const { socket, sent } = freshSocket()
  handlers.message({
    socket,
    message: encodeFrame({
      kind: EClientFrame.Hello,
      threadId,
      channelCursor: null,
      lastEventSeq: 0,
    }),
  })
  await Promise.resolve()
  await Promise.resolve()
  sent.length = 0
  const ask = async (op: EClientRequest, params: unknown) => {
    handlers.message({
      socket,
      message: encodeFrame({ kind: EClientFrame.Request, id: 'req-1', op, params }),
    })
    await Bun.sleep(0)
    return JSON.parse(sent.at(-1) ?? '{}') as { kind: string; ok: boolean; data: unknown }
  }
  return { handlers, sent, ask }
}

describe('the serve channel subscriptions', () => {
  it('answers list-subscriptions with the registry set and its providers', async () => {
    const { subscriptions } = fakeSubscriptions()
    const { ask } = await greeted(subscriptions)

    const reply = await ask(EClientRequest.ListSubscriptions, {})

    expect(reply.ok).toBe(true)
    expect(reply.data).toMatchObject({
      subscriptions: [{ id: 'sub_1', held: 1 }],
      providers: [{ kind: 'github.pull-request' }],
    })
  })

  it('routes subscribe to the registry as the operator in the serve project directory', async () => {
    const { subscriptions, calls } = fakeSubscriptions()
    const { ask } = await greeted(subscriptions)

    const reply = await ask(EClientRequest.Subscribe, {
      threadId,
      provider: 'github.pull-request',
      input: 'dltech/atlas#12',
    })

    expect(calls).toEqual([
      {
        name: 'subscribe',
        args: {
          threadId,
          provider: 'github.pull-request',
          input: 'dltech/atlas#12',
          projectDirectory: '/work/atlas',
          by: ESubscriptionActor.Operator,
          expiresAt: undefined,
        },
      },
    ])
    expect(reply.data).toMatchObject({ ok: true, existed: false, subscription: { id: 'sub_1' } })
  })

  it('carries a refused subscribe as an ok reply with the error', async () => {
    const { subscriptions } = fakeSubscriptions({ outcome: { ok: false, error: 'no such pull' } })
    const { ask } = await greeted(subscriptions)

    const reply = await ask(EClientRequest.Subscribe, {
      threadId,
      provider: 'github.pull-request',
      input: '#0',
    })

    expect(reply.ok).toBe(true)
    expect(reply.data).toEqual({ ok: false, error: 'no such pull' })
  })

  it('routes a status change and an unsubscribe as the operator', async () => {
    const { subscriptions, calls } = fakeSubscriptions()
    const { ask } = await greeted(subscriptions)

    const paused = await ask(EClientRequest.SetSubscriptionStatus, {
      subscriptionId: 'sub_1',
      status: 'paused',
    })
    const removed = await ask(EClientRequest.Unsubscribe, { subscriptionId: 'sub_1' })
    const missing = await ask(EClientRequest.Unsubscribe, { subscriptionId: 'nope' })

    expect(calls).toEqual([
      {
        name: 'setStatus',
        args: {
          subscriptionId: 'sub_1',
          status: ESubscriptionStatus.Paused,
          by: ESubscriptionActor.Operator,
        },
      },
      { name: 'unsubscribe', args: { subscriptionId: 'sub_1', by: ESubscriptionActor.Operator } },
      { name: 'unsubscribe', args: { subscriptionId: 'nope', by: ESubscriptionActor.Operator } },
    ])
    expect(paused.data).toEqual({ ok: true })
    expect(removed.data).toEqual({ ok: true })
    expect(missing.data).toEqual({ ok: false, error: 'No such subscription' })
  })

  it('refuses malformed params and a serve with no registry', async () => {
    const { subscriptions } = fakeSubscriptions()
    const wired = await greeted(subscriptions)
    const malformed = await wired.ask(EClientRequest.Unsubscribe, {})
    expect(malformed.ok).toBe(false)

    const bare = await greeted()
    const refused = await bare.ask(EClientRequest.ListSubscriptions, {})
    expect(refused.ok).toBe(false)
  })

  it('broadcasts the current set to attached clients', async () => {
    const { subscriptions } = fakeSubscriptions()
    const { handlers, sent } = await greeted(subscriptions)

    handlers.broadcastSubscriptions()

    const frame = JSON.parse(sent[0] ?? '{}') as { kind: string; subscriptions: { id: string }[] }
    expect(frame.kind).toBe(EServeFrame.Subscriptions)
    expect(frame.subscriptions[0]?.id).toBe('sub_1')
  })
})
