import { EThreadStreamFrame } from '@dltech/atlas-wire'
import { describe, expect, it } from 'bun:test'
import type { RedisService } from '../../../_lib/redis/redis.service'
import {
  InProcessThreadSignalBus,
  parseThreadSignal,
  RedisThreadSignalBus,
  THREAD_SIGNAL_CHANNEL,
} from './thread-signal.bus'

const HEAD = { threadId: 'thr_1', frame: { type: EThreadStreamFrame.Head, head: 4 } } as const

describe('InProcessThreadSignalBus', () => {
  it('delivers a published signal synchronously to every subscriber', async () => {
    const bus = new InProcessThreadSignalBus()
    const first: string[] = []
    const second: string[] = []
    bus.subscribe({ onMessage: (raw) => first.push(raw) })
    bus.subscribe({ onMessage: (raw) => second.push(raw) })

    const published = bus.publish(HEAD)

    expect(first).toEqual([JSON.stringify(HEAD)])
    expect(second).toEqual([JSON.stringify(HEAD)])
    await published
  })

  it('is not distributed and stops delivering after close', async () => {
    const bus = new InProcessThreadSignalBus()
    const seen: string[] = []
    bus.subscribe({ onMessage: (raw) => seen.push(raw) })

    await bus.close()
    await bus.publish(HEAD)

    expect(bus.distributed).toBe(false)
    expect(seen).toEqual([])
  })
})

function fakeRedis(status = 'ready') {
  const published: Array<{ channel: string; raw: string }> = []
  const handlers: Record<string, (...args: string[]) => void> = {}
  const subscribed: string[] = []
  const quit = { calls: 0 }
  const subscriber = {
    status,
    on(event: string, handler: (...args: string[]) => void) {
      handlers[event] = handler
      return subscriber
    },
    async subscribe(channel: string) {
      subscribed.push(channel)
    },
    async quit() {
      quit.calls += 1
    },
  }
  const redis = {
    client: () => ({
      publish: async (channel: string, raw: string) => {
        published.push({ channel, raw })
      },
    }),
    duplicate: () => subscriber,
  } as unknown as RedisService
  return { redis, published, handlers, subscribed, quit }
}

describe('RedisThreadSignalBus', () => {
  it('publishes the signal as JSON on the thread signal channel', async () => {
    const { redis, published } = fakeRedis()

    await new RedisThreadSignalBus(redis).publish(HEAD)

    expect(published).toEqual([{ channel: THREAD_SIGNAL_CHANNEL, raw: JSON.stringify(HEAD) }])
  })

  it('subscribes a duplicate connection and forwards each message', () => {
    const { redis, handlers, subscribed } = fakeRedis()
    const seen: string[] = []

    new RedisThreadSignalBus(redis).subscribe({ onMessage: (raw) => seen.push(raw) })
    handlers.message?.(THREAD_SIGNAL_CHANNEL, 'raw-1')

    expect(subscribed).toEqual([THREAD_SIGNAL_CHANNEL])
    expect(seen).toEqual(['raw-1'])
  })

  it('quits a connected subscriber on close', async () => {
    const { redis, quit } = fakeRedis('ready')
    const bus = new RedisThreadSignalBus(redis)
    bus.subscribe({ onMessage: () => {} })

    await bus.close()

    expect(bus.distributed).toBe(true)
    expect(quit.calls).toBe(1)
  })

  it('does not wait on a subscriber that never connected', async () => {
    const { redis, quit } = fakeRedis('wait')
    const bus = new RedisThreadSignalBus(redis)
    bus.subscribe({ onMessage: () => {} })

    await bus.close()

    expect(quit.calls).toBe(0)
  })
})

describe('parseThreadSignal', () => {
  it('parses a valid signal', () => {
    expect(parseThreadSignal({ raw: JSON.stringify(HEAD) })).toEqual(HEAD)
  })

  it('returns undefined for malformed json, an unknown frame and a missing threadId', () => {
    expect(parseThreadSignal({ raw: 'nope' })).toBeUndefined()
    expect(
      parseThreadSignal({ raw: JSON.stringify({ threadId: 't', frame: { type: 'x' } }) }),
    ).toBeUndefined()
    expect(parseThreadSignal({ raw: JSON.stringify({ frame: HEAD.frame }) })).toBeUndefined()
  })
})
