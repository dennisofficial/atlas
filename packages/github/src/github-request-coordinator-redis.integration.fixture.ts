import { randomUUID } from 'node:crypto'
import { createRealRedisService, type TestGithubRedis } from './testing/real-redis.fixture'
import { RedisCoordinatorAdapter } from './github-request-coordinator.redis'
import type { CoordinatorAdapter, GithubRequestIdentity } from './github-request-coordinator.types'

export class RedisCoordinatorFixture {
  readonly prefix = `test:request-coordinator:${randomUUID()}:`
  readonly first: CoordinatorAdapter
  readonly second: CoordinatorAdapter
  private readonly ownedKeys = new Set<string>()

  constructor(readonly services: { first: TestGithubRedis; second: TestGithubRedis }) {
    this.first = new RedisCoordinatorAdapter(services.first.client(), this.prefix)
    this.second = new RedisCoordinatorAdapter(services.second.client(), this.prefix)
  }

  key(suffix: string): string {
    const key = `${this.prefix}${suffix}`
    this.ownedKeys.add(key)
    return key
  }

  identity(credentialFingerprint: string): GithubRequestIdentity {
    const window = `http:${Math.floor(Date.now() / 60_000)}:${credentialFingerprint}`
    this.key(window)
    this.key(`${window}:authorization`)
    this.key(`${window}:refresh`)
    this.key(`${window}:lookup`)
    this.key(`${window}:unclassified`)
    this.key('blocked')
    this.key(`blocked:${credentialFingerprint}:core`)
    this.key(`reserve:${credentialFingerprint}:core`)
    return { credentialFingerprint, resource: 'core' }
  }

  async dispose(): Promise<void> {
    try {
      await this.services.first.client().del(...this.ownedKeys)
    } finally {
      await Promise.all([
        this.services.first.onModuleDestroy(),
        this.services.second.onModuleDestroy(),
      ])
    }
  }
}

export async function realRedisCoordinators(): Promise<RedisCoordinatorFixture> {
  const first = await createRealRedisService()
  try {
    const second = await createRealRedisService()
    return new RedisCoordinatorFixture({ first, second })
  } catch (error) {
    await first.onModuleDestroy()
    throw error
  }
}
