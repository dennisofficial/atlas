import { afterAll, describe, expect, it } from 'bun:test'
import { Redis } from 'ioredis'

import { sessionLiveChannel, WAKE_CHANNEL } from '@dltech/atlas-protocol'
import type { LiveFrame } from '@dltech/atlas-protocol'

import { createRedisBus } from '../redis-bus'

const url = process.env.ATLAS_TEST_REDIS_URL ?? 'redis://127.0.0.1:55442'

const waitFor = async (args: { condition: () => boolean; timeoutMs?: number }): Promise<void> => {
  const deadline = Date.now() + (args.timeoutMs ?? 5_000)
  while (!args.condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('redis bus', () => {
  const clients: Redis[] = []
  const buses: ReturnType<typeof createRedisBus>[] = []

  const makeClient = (): Redis => {
    const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 })
    clients.push(client)
    return client
  }

  const makeBus = (): ReturnType<typeof createRedisBus> => {
    const bus = createRedisBus({ url })
    buses.push(bus)
    return bus
  }

  afterAll(async () => {
    for (const bus of buses) await bus.close()
    for (const client of clients) {
      client.disconnect()
      await client.quit().catch(() => undefined)
    }
  })

  it('round-trips a wake message', async () => {
    const sender = makeBus()
    const receiver = makeBus()
    const received: string[] = []
    const unsubscribe = receiver.onWake((sessionId) => {
      received.push(sessionId)
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await sender.wake('session-a')
    await waitFor({ condition: () => received.includes('session-a') })
    unsubscribe()
  })

  it('drops a malformed wake message', async () => {
    const receiver = makeBus()
    const received: string[] = []
    receiver.onWake((sessionId) => {
      received.push(sessionId)
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    const raw = makeClient()
    await raw.publish(WAKE_CHANNEL, 'not json at all')
    await raw.publish(WAKE_CHANNEL, JSON.stringify({ wrong: 'shape' }))
    await raw.publish(WAKE_CHANNEL, JSON.stringify({ sessionId: 'good-one' }))
    await waitFor({ condition: () => received.includes('good-one') })
    expect(received).toEqual(['good-one'])
  })

  it('publishes a live frame on the session channel', async () => {
    const bus = makeBus()
    const listener = makeClient()
    const frames: LiveFrame[] = []
    await listener.subscribe(sessionLiveChannel('session-b'))
    listener.on('message', (_channel: string, message: string) => {
      frames.push(JSON.parse(message) as LiveFrame)
    })
    bus.live({ sessionId: 'session-b', frame: { type: 'status', state: 'thinking' } })
    await waitFor({ condition: () => frames.length > 0 })
    expect(frames[0]).toEqual({ type: 'status', state: 'thinking' })
  })
})
