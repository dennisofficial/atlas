import { EnvService } from '../src/_core/config/env/env.service'
import { RedisService } from '../src/_lib/redis/redis.service'

export const testRedisUrl = process.env.ATLAS_TEST_REDIS_URL ?? 'redis://127.0.0.1:55442'

export async function createRealRedisService(): Promise<RedisService> {
  const service = new RedisService(new EnvService({ REDIS_URL: testRedisUrl }))
  try {
    await service.client().connect()
    await service.client().ping()
    return service
  } catch (cause) {
    await service.onModuleDestroy()
    throw new Error(
      'Real Redis tests require Redis. Run `docker compose -f apps/api/docker-compose.yml up test-redis` from the repo root, or set ATLAS_TEST_REDIS_URL to a running test Redis.',
      { cause },
    )
  }
}
