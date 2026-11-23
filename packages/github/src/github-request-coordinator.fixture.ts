import { randomUUID } from 'node:crypto'
import type { GithubRedis } from './github-ports'
import { GithubRequestCoordinator } from './github-request-coordinator'
import type { GithubService } from './github.service'

export function localCoordinator(
  github: GithubService = { findToken: async () => undefined } as unknown as GithubService,
): GithubRequestCoordinator {
  return new GithubRequestCoordinator(
    { isConfigured: () => false } as unknown as GithubRedis,
    github,
    `test:${randomUUID()}:`,
  )
}
