import { Redis } from 'ioredis'
import type { GithubRedis } from '../github-ports'

export const testRedisUrl = process.env.ATLAS_TEST_REDIS_URL ?? 'redis://127.0.0.1:55442'

export type TestGithubRedis = GithubRedis & { onModuleDestroy(): Promise<void> }

export async function createRealRedisService(): Promise<TestGithubRedis> {
  let primary: Redis | undefined
  const connect = (): Redis => {
    primary ??= new Redis(testRedisUrl, {
      lazyConnect: true,
      keepAlive: 10_000,
      maxRetriesPerRequest: 3,
    })
    return primary
  }
  const service: TestGithubRedis = {
    isConfigured: () => true,
    client: connect,
    duplicate: () => connect().duplicate(),
    onModuleDestroy: async () => {
      const instance = primary
      primary = undefined
      if (instance === undefined || instance.status === 'wait') return
      await instance.quit()
    },
  }
  try {
    await connect().connect()
    await connect().ping()
    return service
  } catch (cause) {
    await service.onModuleDestroy()
    throw new Error(
      'Real Redis tests require Redis. Start the repo test Redis (`docker compose up test-redis`), or set ATLAS_TEST_REDIS_URL to a running test Redis.',
      { cause },
    )
  }
}
