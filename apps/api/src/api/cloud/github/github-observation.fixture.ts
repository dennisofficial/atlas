import { randomUUID } from 'node:crypto'
import { RedisService } from '../../../_lib/redis/redis.service'
import { GithubObservationStore } from './github-observation.store'
import type { GithubService } from './github.service'

export function localObservations(
  github: GithubService = { findToken: async () => undefined } as unknown as GithubService,
): GithubObservationStore {
  return new GithubObservationStore(
    { isConfigured: () => false } as RedisService,
    github,
    `test:${randomUUID()}:`,
  )
}
