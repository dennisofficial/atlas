import { afterAll, describe, expect, it } from 'bun:test'
import { connect, createServer, type Server, type Socket } from 'node:net'

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

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })

const startRelay = (args: {
  port: number
  target: URL
}): Promise<{ server: Server; sockets: Socket[] }> =>
  new Promise((resolve) => {
    const sockets: Socket[] = []
    const server = createServer((client) => {
      const upstream = connect(Number(args.target.port), args.target.hostname)
      sockets.push(client, upstream)
      client.pipe(upstream)
      upstream.pipe(client)
      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
    })
    server.listen(args.port, '127.0.0.1', () => resolve({ server, sockets }))
  })

describe('redis bus', () => {
  const clients: Redis[] = []
  const buses: ReturnType<typeof createRedisBus>[] = []

  const makeClient = (): Redis => {
    const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 })
    clients.push(client)
    return client
  }

  const makeBus = (busUrl: string = url): ReturnType<typeof createRedisBus> => {
    const bus = createRedisBus({ url: busUrl })
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

  it('receives a wake published after redis recovers from a startup outage', async () => {
    const port = await freePort()
    const receiver = makeBus(`redis://127.0.0.1:${port}`)
    const received: string[] = []
    receiver.onWake((sessionId) => {
      received.push(sessionId)
    })
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const relay = await startRelay({ port, target: new URL(url) })
    try {
      const sender = makeBus()
      const publishing = (async () => {
        while (!received.includes('session-after-outage')) {
          await sender.wake('session-after-outage').catch(() => undefined)
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      })()
      await waitFor({
        condition: () => received.includes('session-after-outage'),
        timeoutMs: 15_000,
      })
      await publishing
    } finally {
      for (const socket of relay.sockets) socket.destroy()
      relay.server.close()
    }
  }, 30_000)

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
