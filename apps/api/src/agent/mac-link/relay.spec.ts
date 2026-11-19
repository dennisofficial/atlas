import { describe, expect, test } from 'bun:test'
import type { MacRelayFrame } from '@dltech/atlas-protocol/mac-link'

import { createMacLinkRelay, type MacRelayRedis } from './relay'

type Handler = (...args: never[]) => void

const fakeRedis = (): {
  client: MacRelayRedis
  store: Map<string, { value: string; ttlSeconds: number }>
  subscriptions: Set<string>
  published: { channel: string; message: string }[]
  emit: (event: string, ...args: unknown[]) => void
} => {
  const store = new Map<string, { value: string; ttlSeconds: number }>()
  const subscriptions = new Set<string>()
  const published: { channel: string; message: string }[] = []
  const handlers = new Map<string, Handler[]>()
  const emit = (event: string, ...args: unknown[]): void => {
    for (const handler of handlers.get(event) ?? []) {
      ;(handler as (...inner: unknown[]) => void)(...args)
    }
  }
  const client: MacRelayRedis = {
    get: async (key) => store.get(key)?.value ?? null,
    set: async (key, value, _mode, ttlSeconds) => {
      store.set(key, { value, ttlSeconds })
      return 'OK'
    },
    del: async (key) => (store.delete(key) ? 1 : 0),
    publish: async (channel, message) => {
      published.push({ channel, message })
      return 0
    },
    subscribe: async (...channels) => {
      for (const channel of channels) subscriptions.add(channel)
      return channels.length
    },
    unsubscribe: async (...channels) => {
      for (const channel of channels) subscriptions.delete(channel)
      return channels.length
    },
    on: (event, listener) => {
      handlers.set(event, [...(handlers.get(event) ?? []), listener])
      return client
    },
    quit: async () => 'OK',
    disconnect: () => undefined,
  }
  return { client, store, subscriptions, published, emit }
}

const relayOf = (client: MacRelayRedis, instanceId: string) =>
  createMacLinkRelay({
    url: 'redis://unused',
    instanceId,
    clients: { publisher: client, subscriber: client },
  })

const openFrame = (channelId: string): MacRelayFrame => ({
  origin: 'other',
  target: 'me',
  frame: {
    type: 'open',
    channelId,
    server: { name: 'paper', transport: { kind: 'stdio', command: 'paper' } },
  },
})

describe('createMacLinkRelay', () => {
  test('claims presence with the shared ttl', async () => {
    const redis = fakeRedis()
    const relay = relayOf(redis.client, 'i1')

    await relay.claim('u1', { instanceId: 'i1', deviceId: 'mac-1' })

    expect(redis.store.get('atlas:mac-link:presence:u1')).toEqual({
      value: JSON.stringify({ instanceId: 'i1', deviceId: 'mac-1' }),
      ttlSeconds: 60,
    })
    expect(await relay.presence('u1')).toEqual({ instanceId: 'i1', deviceId: 'mac-1' })
  })

  test('reports no presence for a missing or malformed value', async () => {
    const redis = fakeRedis()
    const relay = relayOf(redis.client, 'i1')

    expect(await relay.presence('u1')).toBeUndefined()

    redis.store.set('atlas:mac-link:presence:u1', { value: 'not json', ttlSeconds: 60 })
    expect(await relay.presence('u1')).toBeUndefined()
  })

  test('releases presence only for the instance that claimed it', async () => {
    const redis = fakeRedis()
    const relay = relayOf(redis.client, 'i1')
    await relay.claim('u1', { instanceId: 'i1', deviceId: 'mac-1' })

    await relay.release('u1', 'i2')
    expect(await relay.presence('u1')).toEqual({ instanceId: 'i1', deviceId: 'mac-1' })

    await relay.release('u1', 'i1')
    expect(await relay.presence('u1')).toBeUndefined()
  })

  test('publishes on the per-user frame channel', async () => {
    const redis = fakeRedis()
    const relay = relayOf(redis.client, 'i1')
    const frame = openFrame('c1')

    await relay.publish('u1', frame)

    expect(redis.published).toEqual([
      { channel: 'atlas:mac-link:frames:u1', message: JSON.stringify(frame) },
    ])
  })

  test('drops a frame whose origin is this instance and delivers the rest', async () => {
    const redis = fakeRedis()
    const relay = relayOf(redis.client, 'i1')
    const seen: MacRelayFrame[] = []
    await relay.listen('u1', (frame) => seen.push(frame))

    expect([...redis.subscriptions]).toEqual(['atlas:mac-link:frames:u1'])

    const own = { ...openFrame('own'), origin: 'i1' }
    redis.emit('message', 'atlas:mac-link:frames:u1', JSON.stringify(own))
    const foreign = { ...openFrame('foreign'), origin: 'i2' }
    redis.emit('message', 'atlas:mac-link:frames:u1', JSON.stringify(foreign))

    expect(seen).toEqual([foreign])
  })

  test('drops a malformed frame', async () => {
    const redis = fakeRedis()
    const relay = relayOf(redis.client, 'i1')
    const seen: MacRelayFrame[] = []
    await relay.listen('u1', (frame) => seen.push(frame))

    redis.emit('message', 'atlas:mac-link:frames:u1', '{"origin":"i2"}')

    expect(seen).toEqual([])
  })

  test('drops the redis subscription when the last listener leaves', async () => {
    const redis = fakeRedis()
    const relay = relayOf(redis.client, 'i1')
    const first = await relay.listen('u1', () => undefined)
    const second = await relay.listen('u1', () => undefined)

    await first()
    expect([...redis.subscriptions]).toEqual(['atlas:mac-link:frames:u1'])

    await second()
    expect([...redis.subscriptions]).toEqual([])
  })

  test('resubscribes every listened channel after a reconnect', async () => {
    const redis = fakeRedis()
    const relay = relayOf(redis.client, 'i1')
    await relay.listen('u1', () => undefined)
    await relay.listen('u2', () => undefined)
    redis.subscriptions.clear()

    redis.emit('ready')

    expect([...redis.subscriptions].sort()).toEqual([
      'atlas:mac-link:frames:u1',
      'atlas:mac-link:frames:u2',
    ])
  })
})
