import { afterAll, describe, expect, it } from 'bun:test'

import { Redis } from 'ioredis'

import { EStepEndReason } from '@dltech/atlas-core'
import {
  EStreamBlockKind,
  sessionLiveBufferKey,
  sessionLiveChannel,
  type LiveFrame,
} from '@dltech/atlas-protocol'

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

  describe('step buffer', () => {
    const key = { runId: 'run-1', step: 0, attempt: 0 }
    const delta = (args: { from: number; text: string }): LiveFrame => ({
      type: 'delta',
      key,
      block: 'b1',
      kind: EStreamBlockKind.Text,
      ...args,
    })

    const publishAll = async (args: { sessionId: string; frames: LiveFrame[] }) => {
      const publisher = createRedisLiveFrames({ url })
      publishers.push(publisher)
      const reader = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 })
      clients.push(reader)
      const received: LiveFrame[] = []
      await reader.subscribe(sessionLiveChannel(args.sessionId))
      reader.on('message', (_channel: string, message: string) => {
        received.push(JSON.parse(message) as LiveFrame)
      })
      for (const frame of args.frames) publisher.live({ sessionId: args.sessionId, frame })
      const deadline = Date.now() + 5_000
      while (received.length < args.frames.length && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return { received, reader }
    }

    const linesOf = (raw: string | null): LiveFrame[] =>
      (raw ?? '')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as LiveFrame)

    it('appends each frame to the buffer key in publish order and sets an expiry', async () => {
      const sessionId = `session-buf-${Date.now()}`
      const frames: LiveFrame[] = [
        { type: 'step-start', key },
        delta({ from: 0, text: 'He' }),
        delta({ from: 2, text: 'llo' }),
        { type: 'step-end', key, reason: EStepEndReason.Finished },
      ]
      const { received, reader } = await publishAll({ sessionId, frames })
      expect(received).toEqual(frames)
      expect(linesOf(await reader.get(sessionLiveBufferKey(sessionId)))).toEqual(frames)
      const ttl = await reader.ttl(sessionLiveBufferKey(sessionId))
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(600)
    }, 15_000)

    it('replaces the buffer when the next step starts', async () => {
      const sessionId = `session-replace-${Date.now()}`
      const next = { runId: 'run-1', step: 4, attempt: 0 }
      const { reader } = await publishAll({
        sessionId,
        frames: [
          { type: 'step-start', key },
          delta({ from: 0, text: 'old' }),
          { type: 'step-end', key, reason: EStepEndReason.Finished },
          { type: 'step-start', key: next },
        ],
      })
      expect(linesOf(await reader.get(sessionLiveBufferKey(sessionId)))).toEqual([
        { type: 'step-start', key: next },
      ])
      expect(await reader.ttl(sessionLiveBufferKey(sessionId))).toBeGreaterThan(0)
    }, 15_000)

    it('leaves other frames out of the buffer', async () => {
      const sessionId = `session-plain-${Date.now()}`
      const { reader } = await publishAll({
        sessionId,
        frames: [{ type: 'status', state: 'thinking' }],
      })
      expect(await reader.exists(sessionLiveBufferKey(sessionId))).toBe(0)
    }, 15_000)
  })

  it('forgets a session once its step ends', async () => {
    const publisher = createRedisLiveFrames({ url })
    publishers.push(publisher)
    const key = { runId: 'run-evict', step: 0, attempt: 0 }
    for (let n = 0; n < 50; n += 1) {
      const sessionId = `session-evict-${n}`
      publisher.live({ sessionId, frame: { type: 'step-start', key } })
      publisher.live({
        sessionId,
        frame: { type: 'step-end', key, reason: EStepEndReason.Finished },
      })
    }
    expect(publisher.trackedSessions()).toBe(0)
  }, 15_000)
})
