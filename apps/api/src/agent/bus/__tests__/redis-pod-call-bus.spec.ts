import type { PodCallBus } from '@dltech/atlas-host'
import {
  ELiveOpFailure,
  EPodCallKind,
  type PodCallRequest,
  type PodReady,
  type PodStreamFrame,
} from '@dltech/atlas-protocol'
import { afterEach, describe, expect, it } from 'bun:test'
import type { Redis } from 'ioredis'

import { until } from '../../stream/__tests__/until'
import { podCallClientsOf, type PodCallClients } from '../pod-call-redis'
import { createRedisPodCallBus } from '../redis-pod-call-bus'

const url = process.env.ATLAS_TEST_REDIS_URL ?? 'redis://127.0.0.1:55442'

const invokeOf = (args: { replyTo: string; sessionId: string }): PodCallRequest => ({
  kind: EPodCallKind.Invoke,
  requestId: crypto.randomUUID(),
  replyTo: args.replyTo,
  sessionId: args.sessionId,
  targetHostId: 1,
  op: { op: 'stat', path: '/tmp' },
})

type Handler = (...args: never[]) => void

const fakeClient = (
  over: { subscribe?: (...channels: string[]) => Promise<unknown> } = {},
): { client: Redis; published: { channel: string; message: string }[] } => {
  const handlers = new Map<string, Handler[]>()
  const published: { channel: string; message: string }[] = []
  const client = {
    status: 'ready',
    publish: async (channel: string, message: string) => {
      published.push({ channel, message })
      return 1
    },
    subscribe: async (..._channels: string[]) => 1,
    unsubscribe: async (..._channels: string[]) => 1,
    on: (event: string, listener: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), listener])
      return client
    },
    once: (event: string, listener: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), listener])
      return client
    },
    quit: async () => 'OK',
    disconnect: () => undefined,
    ...over,
  }
  return { client: client as unknown as Redis, published }
}

const deferred = (): { promise: Promise<void>; release: () => void } => {
  let release: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe.skipIf(process.env.ATLAS_TEST_REDIS_URL === undefined)('redis pod call bus', () => {
  const buses: PodCallBus[] = []

  afterEach(async () => {
    for (const bus of buses.splice(0)) await bus.close()
  })

  const busOf = (): PodCallBus => {
    const bus = createRedisPodCallBus({ url })
    buses.push(bus)
    return bus
  }

  const busWith = (clients: PodCallClients): PodCallBus => {
    const bus = createRedisPodCallBus({ url, clients })
    buses.push(bus)
    return bus
  }

  it('keeps the publisher from resending or queueing a command', async () => {
    const { publisher, subscriber } = podCallClientsOf({ url })

    expect(publisher.options.autoResendUnfulfilledCommands).toBe(false)
    expect(publisher.options.enableOfflineQueue).toBe(false)
    publisher.disconnect()
    subscriber.disconnect()
  })

  it('carries a request to the other instance and answers with its reply', async () => {
    const holder = busOf()
    const requester = busOf()
    const seen: PodCallRequest[] = []
    holder.onRequest((request) => {
      seen.push(request)
      void holder.reply({
        replyTo: request.replyTo,
        reply: {
          requestId: request.requestId,
          outcome: { state: 'unavailable', reason: ELiveOpFailure.Asleep },
        },
      })
    })
    await Bun.sleep(100)

    const request = invokeOf({
      replyTo: requester.requesterId,
      sessionId: `ses-${crypto.randomUUID()}`,
    })
    const outcome = await requester.request({ request, timeoutMs: 2_000 })

    expect(seen.map((entry) => entry.requestId)).toEqual([request.requestId])
    expect(outcome).toEqual({ state: 'unavailable', reason: ELiveOpFailure.Asleep })
  })

  it('fails a request nobody answers', async () => {
    const requester = busOf()

    const outcome = await requester.request({
      request: invokeOf({
        replyTo: requester.requesterId,
        sessionId: `ses-${crypto.randomUUID()}`,
      }),
      timeoutMs: 50,
    })

    expect(outcome).toEqual({ state: 'failed', message: 'invoke timed out after 50ms' })
  })

  it('fails a request whose signal aborts', async () => {
    const requester = busOf()
    const controller = new AbortController()

    const answer = requester.request({
      request: invokeOf({
        replyTo: requester.requesterId,
        sessionId: `ses-${crypto.randomUUID()}`,
      }),
      timeoutMs: 5_000,
      signal: controller.signal,
    })
    controller.abort()

    expect(await answer).toEqual({ state: 'failed', message: 'aborted' })
  })

  it('fails a request that aborts before the subscription resolves and publishes nothing', async () => {
    const gate = deferred()
    const publisher = fakeClient()
    const subscriber = fakeClient({ subscribe: () => gate.promise })
    const bus = busWith({ publisher: publisher.client, subscriber: subscriber.client })
    const controller = new AbortController()

    const answer = bus.request({
      request: invokeOf({
        replyTo: bus.requesterId,
        sessionId: `ses-${crypto.randomUUID()}`,
      }),
      timeoutMs: 5_000,
      signal: controller.signal,
    })
    controller.abort()

    expect(await answer).toEqual({ state: 'failed', message: 'aborted' })
    gate.release()
    await Bun.sleep(50)
    expect(publisher.published).toEqual([])
  })

  it('fails a request whose subscription is refused and publishes nothing', async () => {
    const publisher = fakeClient()
    const subscriber = fakeClient({
      subscribe: async () => {
        throw new Error('subscribe refused')
      },
    })
    const bus = busWith({ publisher: publisher.client, subscriber: subscriber.client })

    const outcome = await bus.request({
      request: invokeOf({
        replyTo: bus.requesterId,
        sessionId: `ses-${crypto.randomUUID()}`,
      }),
      timeoutMs: 5_000,
    })

    expect(outcome).toEqual({ state: 'failed', message: 'subscribe refused' })
    expect(publisher.published).toEqual([])
  })

  it('flows stream frames until the listener unsubscribes', async () => {
    const holder = busOf()
    const watcher = busOf()
    const streamId = `stream-${crypto.randomUUID()}`
    const frames: PodStreamFrame[] = []
    const unsubscribe = await watcher.subscribeFrames({
      streamId,
      listener: (frame) => frames.push(frame),
    })

    await holder.publishFrame({ streamId, frame: { type: 'closed', reason: 'detached' } })
    await until(() => frames.length === 1, 'pod stream frame')

    expect(frames[0]).toEqual({ type: 'closed', reason: 'detached' })

    await unsubscribe()
    await holder.publishFrame({ streamId, frame: { type: 'closed', reason: 'asleep' } })
    await Bun.sleep(100)

    expect(frames).toHaveLength(1)
  })

  it('reaches every instance with a pod ready signal', async () => {
    const first = busOf()
    const second = busOf()
    const ready = { sessionId: `ses-${crypto.randomUUID()}`, hostId: 7 }
    const seen: PodReady[] = []
    const record = (signal: PodReady) => {
      if (signal.sessionId === ready.sessionId) seen.push(signal)
    }
    first.onReady(record)
    second.onReady(record)
    await Bun.sleep(100)

    await first.ready(ready)
    await until(() => seen.length === 2, 'pod ready on both instances')

    expect(seen).toEqual([ready, ready])
  })
})
