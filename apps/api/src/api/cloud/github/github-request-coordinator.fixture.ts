import { randomUUID } from 'node:crypto'
import { RedisService } from '../../../_lib/redis/redis.service'
import { GithubRequestCoordinator } from './github-request-coordinator'
import type { GithubService } from './github.service'

export function localCoordinator(
  github: GithubService = { findToken: async () => undefined } as unknown as GithubService,
): GithubRequestCoordinator {
  return new GithubRequestCoordinator(
    { isConfigured: () => false } as RedisService,
    github,
    `test:${randomUUID()}:`,
  )
}
