import { afterAll, describe, expect, it } from 'bun:test'

import { Redis } from 'ioredis'

import { EStreamBlockKind, type StreamServerMessage } from '@dltech/atlas-protocol'

import { LiveOverlay } from '../../stream/overlay/live-overlay'
import { systemHostTimers } from '../../stream/system-timers'
import { until } from '../../stream/__tests__/test-client'
import { createRedisLiveFrames, type RedisLiveFrames } from '../redis-live-frames'
import { createRedisLiveSource } from '../redis-live-source'
import type { LiveSource } from '../../stream/live-source'

const url = process.env.ATLAS_TEST_REDIS_URL ?? 'redis://127.0.0.1:55442'
const KEY = { runId: 'run-1', step: 0, attempt: 0 }

describe.skipIf(process.env.ATLAS_TEST_REDIS_URL === undefined)('redis live source', () => {
  const producers: RedisLiveFrames[] = []
  const sources: LiveSource[] = []
  const admin = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 })

  afterAll(async () => {
    for (const producer of producers.splice(0)) await producer.close()
    for (const source of sources.splice(0)) await source.close()
    admin.disconnect()
  })

  const setup = (sessionId: string) => {
    const producer = createRedisLiveFrames({ url })
    const source = createRedisLiveSource({ url })
    producers.push(producer)
    sources.push(source)
    const overlay = new LiveOverlay({ source, timers: systemHostTimers, log: undefined })
    const sent: StreamServerMessage[] = []
    overlay.add({ id: 'sub-1', sessionId, send: (m) => sent.push(m), bufferedAmount: () => 0 })
    const delta = (args: { from: number; text: string }) =>
      producer.live({
        sessionId,
        frame: { type: 'delta', key: KEY, block: 'b1', kind: EStreamBlockKind.Text, ...args },
      })
    const text = (): string => {
      let out = ''
      for (const message of sent) {
        if (message.type === 'overlay') out = message.blocks[0]?.text ?? ''
        if (message.type === 'delta') out = out.slice(0, message.from) + message.text
      }
      return out
    }
    return { producer, overlay, sent, delta, text }
  }

  it('joins mid-step with the text so far and follows the rest', async () => {
    const sessionId = `join-${Date.now()}`
    const { producer, delta, text, sent } = setup(sessionId)
    producer.live({ sessionId, frame: { type: 'step-start', key: KEY, afterSeq: 0 } })
    delta({ from: 0, text: 'Hello' })
    await until(() => sent.some((m) => m.type === 'overlay'), 'the first overlay')
    delta({ from: 5, text: ', world' })
    await until(() => text() === 'Hello, world', 'the full text')
  }, 15_000)

  it('re-snapshots every watcher after its subscriber connection is killed', async () => {
    const sessionId = `gap-${Date.now()}`
    const { producer, delta, text, sent } = setup(sessionId)
    producer.live({ sessionId, frame: { type: 'step-start', key: KEY, afterSeq: 0 } })
    delta({ from: 0, text: 'abc' })
    await until(() => text() === 'abc', 'the first text')
    const overlays = sent.filter((m) => m.type === 'overlay').length
    await admin.call('CLIENT', 'KILL', 'TYPE', 'pubsub')
    await until(
      () => sent.filter((m) => m.type === 'overlay').length > overlays,
      'a fresh overlay after the reconnect',
    )
    delta({ from: 3, text: 'def' })
    await until(() => text() === 'abcdef', 'text after the reconnect')
  }, 20_000)
})
