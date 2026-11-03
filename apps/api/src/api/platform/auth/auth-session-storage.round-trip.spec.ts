import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createRealRedisService } from '../../../../test/real-redis.fixture'
import type { RedisService } from '../../../_lib/redis/redis.service'

const prefix = `auth:`
const credentials = {
  email: 'redis-round-trip@test.local',
  password: 'a-long-enough-password',
  name: 'Redis Round Trip',
}

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` })

describe('better-auth sessions over Redis with Postgres kept', () => {
  useTestDatabase()
  let redis: RedisService
  let plain: typeof import('./auth.server').auth
  let cached: typeof import('./auth.server').auth

  beforeAll(async () => {
    redis = await createRealRedisService()
    ;({ auth: plain } = await import('./auth.server'))
    process.env.REDIS_URL = `${(await import('../../../../test/real-redis.fixture')).testRedisUrl}`
    ;({ auth: cached } = await import(`./auth.server?redis=${Date.now()}`))
  })

  afterAll(async () => {
    delete process.env.REDIS_URL
    const keys = await redis.client().keys(`${prefix}*`)
    if (keys.length > 0) await redis.client().del(...keys)
    await redis.onModuleDestroy()
  })

  it('resolves a session that only Postgres holds, and caches the next sign-in in both', async () => {
    const before = await plain.api.signUpEmail({ body: credentials })
    expect(await redis.client().get(`${prefix}${before.token ?? ''}`)).toBeNull()

    const old = await cached.api.getSession({ headers: bearer(before.token ?? '') })
    expect(old?.user.id).toBe(before.user.id)

    const signedIn = await cached.api.signInEmail({
      body: { email: credentials.email, password: credentials.password },
    })
    expect(await redis.client().get(`${prefix}${signedIn.token}`)).not.toBeNull()
    const fresh = await cached.api.getSession({ headers: bearer(signedIn.token) })
    expect(fresh?.user.id).toBe(before.user.id)

    await redis.client().del(`${prefix}${signedIn.token}`)
    const evicted = await cached.api.getSession({ headers: bearer(signedIn.token) })
    expect(evicted?.user.id).toBe(before.user.id)
  })
})
