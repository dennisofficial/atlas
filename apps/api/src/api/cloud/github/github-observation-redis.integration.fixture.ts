import { randomUUID } from 'node:crypto'
import { createRealRedisService } from '../../../../test/real-redis.fixture'
import type { RedisService } from '../../../_lib/redis/redis.service'
import { RedisObservationAdapter } from './github-observation.redis'
import type {
  GithubRequestIdentity,
  ObservationAdapter,
  ObservationLease,
  ObservedPr,
} from './github-observation.types'

export class RedisObservationFixture {
  readonly prefix = `test:observation-adapter:${randomUUID()}:`
  readonly first: ObservationAdapter
  readonly second: ObservationAdapter
  private readonly ownedKeys = new Set<string>()

  constructor(readonly services: { first: RedisService; second: RedisService }) {
    this.first = new RedisObservationAdapter(services.first.client(), this.prefix)
    this.second = new RedisObservationAdapter(services.second.client(), this.prefix)
    this.key('active')
    this.key('cursor')
  }

  key(suffix: string): string {
    const key = `${this.prefix}${suffix}`
    this.ownedKeys.add(key)
    return key
  }

  lease(args: { id?: string; ttlMs?: number; keys?: ObservedPr[] } = {}): ObservationLease {
    const id = args.id ?? randomUUID()
    const keys = args.keys ?? [{ repoFullName: 'owner/repo', prNumber: 42 }]
    const expiresAt = Date.now() + (args.ttlMs ?? 10_000)
    this.key(`lease:${id}`)
    for (const key of keys) {
      this.key(`repo:${key.repoFullName}`)
      this.key(`pr:${key.repoFullName}#${key.prNumber}`)
    }
    return {
      id,
      userId: `user-${id}`,
      credentialFingerprint: `credential-${id}`,
      expiresAt,
      keys,
      authorizedUntil: Object.fromEntries(keys.map((key) => [key.repoFullName, expiresAt])),
    }
  }

  identity(credentialFingerprint: string): GithubRequestIdentity {
    this.key(`http:${Math.floor(Date.now() / 60_000)}`)
    this.key('blocked')
    this.key(`blocked:${credentialFingerprint}:core`)
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

export async function realRedisObservations(): Promise<RedisObservationFixture> {
  const first = await createRealRedisService()
  try {
    const second = await createRealRedisService()
    return new RedisObservationFixture({ first, second })
  } catch (error) {
    await first.onModuleDestroy()
    throw error
  }
}
