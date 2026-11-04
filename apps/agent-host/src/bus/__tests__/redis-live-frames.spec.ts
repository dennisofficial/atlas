import { afterAll, describe, expect, it } from 'bun:test'

import { Redis } from 'ioredis'

import { sessionLiveChannel, type LiveFrame } from '@dltech/atlas-protocol'

import { createRedisLiveFrames, type RedisLiveFrames } from '../redis-live-frames'

const url = process.env.ATLAS_TEST_REDIS_URL ?? 'redis://127.0.0.1:55442'

describe.skipIf(process.env.ATLAS_TEST_REDIS_URL === undefined)('redis live frames', () => {
  const clients: Redis[] = []
  const publishers: RedisLiveFrames[] = []

  afterAll(async () => {
    for (const publisher of publishers.splice(0)) await publisher.close()
    for (const client of clients.splice(0)) {
      client.disconnect()
      await client.quit().catch(() => undefined)
    }
  })

  it('publishes a live frame on the session channel', async () => {
    const frames = createRedisLiveFrames({ url })
    publishers.push(frames)
    const listener = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 })
    clients.push(listener)
    const received: LiveFrame[] = []
    await listener.subscribe(sessionLiveChannel('session-b'))
    listener.on('message', (_channel: string, message: string) => {
      received.push(JSON.parse(message) as LiveFrame)
    })
    frames.live({ sessionId: 'session-b', frame: { type: 'status', state: 'thinking' } })
    const deadline = Date.now() + 5_000
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(received[0]).toEqual({ type: 'status', state: 'thinking' })
  }, 15_000)

  it('closes a live client and tolerates a second close', async () => {
    const frames = createRedisLiveFrames({ url })
    frames.live({ sessionId: 'session-close', frame: { type: 'status', state: 'thinking' } })
    await expect(frames.close()).resolves.toBeUndefined()
    await expect(frames.close()).resolves.toBeUndefined()
  }, 15_000)
})
