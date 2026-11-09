import { beforeEach, describe, expect, it } from 'bun:test'
import { RedisService } from '../../../_lib/redis/redis.service'
import { formatPresence } from './presence-entries'
import { presenceKey, PresenceService } from './presence.service'

class FakeRedis {
  readonly hashes = new Map<string, Map<string, string>>()
  readonly expiries: number[] = []

  hset(key: string, field: string, value: string): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>()
    hash.set(field, value)
    this.hashes.set(key, hash)
    return Promise.resolve(1)
  }

  hdel(key: string, field: string): Promise<number> {
    const removed = this.hashes.get(key)?.delete(field) === true
    return Promise.resolve(removed ? 1 : 0)
  }

  hgetall(key: string): Promise<Record<string, string>> {
    return Promise.resolve(Object.fromEntries(this.hashes.get(key) ?? []))
  }

  expire(_key: string, seconds: number): Promise<number> {
    this.expiries.push(seconds)
    return Promise.resolve(1)
  }
}

const serviceWith = (args: { configured: boolean; redis: FakeRedis }): PresenceService =>
  new PresenceService({
    isConfigured: () => args.configured,
    client: () => args.redis,
  } as unknown as RedisService)

const seedSighting = (args: {
  redis: FakeRedis
  userId: string
  clientId: string
  threadId: string
  at: number
}): void => {
  const key = presenceKey(args.userId)
  const hash = args.redis.hashes.get(key) ?? new Map<string, string>()
  hash.set(args.clientId, formatPresence({ threadId: args.threadId, at: args.at }))
  args.redis.hashes.set(key, hash)
}

describe('PresenceService', () => {
  let redis: FakeRedis

  beforeEach(() => {
    redis = new FakeRedis()
  })

  it('records a sighting with a bounded lifetime', async () => {
    await serviceWith({ configured: true, redis }).report({
      userId: 'usr-1',
      clientId: 'cli-1',
      threadId: 'thr-1',
    })

    expect(redis.expiries.length).toBe(1)
    expect(
      await serviceWith({ configured: true, redis }).isWatching({
        userId: 'usr-1',
        threadId: 'thr-1',
      }),
    ).toBe(true)
  })

  it('clears a client that stops watching', async () => {
    const service = serviceWith({ configured: true, redis })
    await service.report({ userId: 'usr-1', clientId: 'cli-1', threadId: 'thr-1' })
    await service.report({ userId: 'usr-1', clientId: 'cli-1', threadId: null })

    expect(await service.isWatching({ userId: 'usr-1', threadId: 'thr-1' })).toBe(false)
  })

  it('separates users', async () => {
    const service = serviceWith({ configured: true, redis })
    await service.report({ userId: 'usr-1', clientId: 'cli-1', threadId: 'thr-1' })

    expect(await service.isWatching({ userId: 'usr-2', threadId: 'thr-1' })).toBe(false)
  })

  it('treats an old sighting as gone', async () => {
    seedSighting({ redis, userId: 'usr-1', clientId: 'cli-1', threadId: 'thr-1', at: 1 })

    expect(
      await serviceWith({ configured: true, redis }).isWatching({
        userId: 'usr-1',
        threadId: 'thr-1',
      }),
    ).toBe(false)
  })

  it('never suppresses a push without Redis', async () => {
    const service = serviceWith({ configured: false, redis })

    expect(await service.isWatching({ userId: 'usr-1', threadId: 'thr-1' })).toBe(false)
  })
})
