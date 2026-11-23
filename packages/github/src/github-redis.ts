import { Redis } from 'ioredis'
import type { GithubRedis } from './github-ports'

export type GithubRedisConnection = GithubRedis & { close(): Promise<void> }

const create = (url: string): Redis =>
  new Redis(url, {
    lazyConnect: true,
    keepAlive: 10_000,
    maxRetriesPerRequest: 3,
  })

export function githubRedisOf(args: { url: string | undefined }): GithubRedisConnection {
  let instance: Redis | undefined

  const urlOf = (): string => {
    if (args.url === undefined) {
      throw new Error(
        'REDIS_URL is not set — check isConfigured() and run local-only instead of calling client()',
      )
    }
    return args.url
  }

  return {
    isConfigured: () => args.url !== undefined,
    client: () => {
      instance ??= create(urlOf())
      return instance
    },
    duplicate: () => create(urlOf()).duplicate(),
    close: async () => {
      const current = instance
      instance = undefined
      if (current === undefined || current.status === 'wait') return
      await current.quit()
    },
  }
}
