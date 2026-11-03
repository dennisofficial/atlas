import { describe, expect, it } from 'bun:test'
import { redisSessionStorage } from './auth-session-storage'

const fakeRedis = (args: { failing?: boolean } = {}) => {
  const values = new Map<string, string>()
  const ttls = new Map<string, number>()
  const guard = () => {
    if (args.failing === true) throw new Error('connection refused')
  }
  return {
    values,
    ttls,
    get: async (key: string) => {
      guard()
      return values.get(key) ?? null
    },
    getdel: async (key: string) => {
      guard()
      const value = values.get(key) ?? null
      values.delete(key)
      return value
    },
    incr: async (key: string) => {
      guard()
      const next = Number(values.get(key) ?? '0') + 1
      values.set(key, String(next))
      return next
    },
    expire: async (key: string, seconds: number) => {
      ttls.set(key, seconds)
      return 1
    },
    set: async (key: string, value: string, _mode?: 'EX', seconds?: number) => {
      guard()
      values.set(key, value)
      if (seconds !== undefined) ttls.set(key, seconds)
      return 'OK' as const
    },
    del: async (key: string) => {
      guard()
      return values.delete(key) ? 1 : 0
    },
  }
}

const silent = () => undefined

describe('redisSessionStorage', () => {
  it('stores values under the auth prefix with their ttl', async () => {
    const redis = fakeRedis()
    const storage = redisSessionStorage({ redis: redis as never, log: silent })

    await storage.set('token-1', '{"session":{}}', 600)

    expect(redis.values.get('auth:token-1')).toBe('{"session":{}}')
    expect(redis.ttls.get('auth:token-1')).toBe(600)
    expect(await storage.get('token-1')).toBe('{"session":{}}')
  })

  it('answers a miss when Redis is down, so better-auth reads Postgres', async () => {
    const storage = redisSessionStorage({
      redis: fakeRedis({ failing: true }) as never,
      log: silent,
    })

    expect(await storage.get('token-1')).toBeNull()
    await storage.set('token-1', 'value', 600)
  })

  it('refuses a delete Redis cannot apply, so a revoked session cannot stay cached', async () => {
    const storage = redisSessionStorage({
      redis: fakeRedis({ failing: true }) as never,
      log: silent,
    })

    await expect(Promise.resolve(storage.delete('token-1'))).rejects.toThrow('connection refused')
  })

  it('expires a counter only when it is created', async () => {
    const redis = fakeRedis()
    const storage = redisSessionStorage({ redis: redis as never, log: silent })

    expect(await storage.increment('window', 10)).toBe(1)
    redis.ttls.delete('auth:window')
    expect(await storage.increment('window', 10)).toBe(2)
    expect(redis.ttls.has('auth:window')).toBe(false)
  })
})
