import { afterAll, describe, expect, it } from 'bun:test'

import { Redis } from 'ioredis'

import { EStepEndReason } from '@dltech/atlas-core'
import { LiveStepBuffer, systemTimers } from '@dltech/atlas-host'
import { sessionLiveBufferKey, type LiveFrame } from '@dltech/atlas-protocol'

import { createRedisLiveFrames } from '../redis-live-frames'

const url = process.env.ATLAS_TEST_REDIS_URL ?? 'redis://127.0.0.1:55442'

const ANSWER_BYTES = 20 * 1024
const CHUNK_GAP_MS = 2

const answer = (): string => {
  const sentence = 'The quick brown fox jumps over the lazy dog and keeps on running. '
  return sentence.repeat(Math.ceil(ANSWER_BYTES / sentence.length)).slice(0, ANSWER_BYTES)
}

const chunksOf = (text: string): string[] => {
  const chunks: string[] = []
  for (let at = 0, size = 5; at < text.length; at += size, size = 5 + ((size * 7) % 16)) {
    chunks.push(text.slice(at, at + size))
  }
  return chunks
}

const commandsProcessed = async (client: Redis): Promise<number> => {
  const stats = await client.info('stats')
  const match = /total_commands_processed:(\d+)/.exec(stats)
  return Number(match?.[1] ?? 0)
}

describe.skipIf(process.env.ATLAS_TEST_REDIS_URL === undefined)('live delta measurement', () => {
  const inspector = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 })

  afterAll(async () => {
    inspector.disconnect()
  })

  it('streams a 20 KiB answer in 5-20 char chunks, 2 ms apart', async () => {
    await inspector.connect()
    const sessionId = `session-measure-${Date.now()}`
    const publisher = createRedisLiveFrames({ url })
    const frames: LiveFrame[] = []
    const buffer = new LiveStepBuffer({
      timers: { now: () => Date.now(), ...systemTimers },
      emit: (frame) => {
        frames.push(frame)
        publisher.live({ sessionId, frame })
      },
    })
    const key = { runId: 'run-measure', step: 0, attempt: 0 }
    const text = answer()
    const chunks = chunksOf(text)

    const before = await commandsProcessed(inspector)
    const startedAt = performance.now()
    buffer.push({ type: 'step-start', key })
    for (const piece of chunks) {
      buffer.push({ type: 'chunk', key, chunk: { type: 'text-delta', id: 'b1', text: piece } })
      await new Promise((resolve) => setTimeout(resolve, CHUNK_GAP_MS))
    }
    buffer.push({ type: 'step-end', key, reason: EStepEndReason.Finished })
    await publisher.close()
    const seconds = (performance.now() - startedAt) / 1000
    const after = await commandsProcessed(inspector)

    const commands = after - before - 1
    const deltas = frames.filter((frame) => frame.type === 'delta')
    const rebuilt = deltas.map((frame) => (frame.type === 'delta' ? frame.text : '')).join('')
    const buffered = (await inspector.get(sessionLiveBufferKey(sessionId))) ?? ''

    console.log(
      JSON.stringify({
        chunks: chunks.length,
        seconds: Number(seconds.toFixed(2)),
        framesPerStep: frames.length,
        deltaFrames: deltas.length,
        redisCommands: commands,
        redisCommandsPerSecond: Number((commands / seconds).toFixed(1)),
        framesPerSecond: Number((frames.length / seconds).toFixed(1)),
      }),
    )

    expect(rebuilt).toBe(text)
    expect(buffered.split('\n').filter((line) => line.length > 0)).toHaveLength(frames.length)
    expect(frames.length).toBeLessThan(chunks.length / 10)
    expect(commands / seconds).toBeLessThan(100)
    await inspector.del(sessionLiveBufferKey(sessionId))
  }, 30_000)
})
