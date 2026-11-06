import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createRealRedisService } from '../../../../test/real-redis.fixture'
import type { RedisService } from '../../../_lib/redis/redis.service'
import { redisSessionStorage } from './auth-session-storage'

const prefix = 'counter-spec:'

describe('redisSessionStorage counters on real Redis', () => {
  let redis: RedisService

  beforeAll(async () => {
    redis = await createRealRedisService()
  })

  afterAll(async () => {
    const keys = await redis.client().keys(`${prefix}*`)
    if (keys.length > 0) await redis.client().del(...keys)
    await redis.onModuleDestroy()
  })

  const crashingBetweenCommands = () =>
    new Proxy(redis.client(), {
      get(target, property) {
        if (property === 'expire') {
          return async () => {
            throw new Error('process died after INCR')
          }
        }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

  it('never leaves a counter without a ttl, even if the process dies mid-increment', async () => {
    const storage = redisSessionStorage({ redis: crashingBetweenCommands(), prefix })

    await storage.increment('crash', 30)

    const ttl = await redis.client().ttl(`${prefix}crash`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(30)
  })

  it('keeps counting inside one window without extending it', async () => {
    const storage = redisSessionStorage({ redis: redis.client(), prefix })

    expect(await storage.increment('window', 60)).toBe(1)
    await redis.client().expire(`${prefix}window`, 20)
    expect(await storage.increment('window', 60)).toBe(2)

    expect(await redis.client().ttl(`${prefix}window`)).toBeLessThanOrEqual(20)
  })

  it('gives a ttl to a counter an earlier crash left without one', async () => {
    const storage = redisSessionStorage({ redis: redis.client(), prefix })
    await redis.client().set(`${prefix}orphan`, '5')

    expect(await storage.increment('orphan', 30)).toBe(6)

    expect(await redis.client().ttl(`${prefix}orphan`)).toBeGreaterThan(0)
  })
})
