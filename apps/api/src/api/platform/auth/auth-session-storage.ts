import type { BetterAuthOptions } from 'better-auth'
import { Redis } from 'ioredis'

export type SecondaryStorage = NonNullable<BetterAuthOptions['secondaryStorage']>

export const AUTH_STORAGE_PREFIX = 'auth:'

const INCREMENT_WITH_TTL = `
local value = redis.call('INCR', KEYS[1])
if tonumber(ARGV[1]) > 0 and redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return value`

type StorageLog = (message: string, cause: unknown) => void

const logToConsole: StorageLog = (message, cause) => {
  console.error(message, cause instanceof Error ? cause.message : String(cause))
}

/**
 * better-auth keeps every session row in Postgres too (`storeSessionInDatabase`), so a Redis read
 * that fails or misses falls through to Postgres instead of signing the caller out. Writes that
 * fail are logged and skipped for the same reason; a failed delete still throws, because a revoked
 * session left in Redis would stay valid until its TTL.
 */
export function redisSessionStorage(args: {
  redis: Pick<Redis, 'get' | 'getdel' | 'eval' | 'set' | 'del'>
  prefix?: string | undefined
  log?: StorageLog | undefined
}): SecondaryStorage {
  const { redis } = args
  const prefix = args.prefix ?? AUTH_STORAGE_PREFIX
  const log = args.log ?? logToConsole
  const keyOf = (key: string): string => `${prefix}${key}`

  return {
    get: async (key) => {
      try {
        return await redis.get(keyOf(key))
      } catch (cause) {
        log('auth session storage read failed; falling back to Postgres', cause)
        return null
      }
    },
    getAndDelete: (key) => redis.getdel(keyOf(key)),
    increment: async (key, ttl) => {
      return Number(await redis.eval(INCREMENT_WITH_TTL, 1, keyOf(key), ttl))
    },
    set: async (key, value, ttl) => {
      try {
        if (ttl !== undefined && ttl > 0) await redis.set(keyOf(key), value, 'EX', ttl)
        else await redis.set(keyOf(key), value)
      } catch (cause) {
        log('auth session storage write failed; Postgres still holds the session', cause)
        await redis.del(keyOf(key)).catch(() => undefined)
      }
    },
    delete: async (key) => {
      await redis.del(keyOf(key))
    },
  }
}

export function sessionStorageFromEnv(url: string | undefined): SecondaryStorage | undefined {
  if (url === undefined || url === '') return undefined
  return redisSessionStorage({
    redis: new Redis(url, { lazyConnect: true, keepAlive: 10_000, maxRetriesPerRequest: 3 }),
  })
}
