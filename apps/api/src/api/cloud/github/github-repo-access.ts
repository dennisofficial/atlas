import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common'
import type { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'
import { rateLimitOf } from './github-rate-limit'

const GITHUB_REQUEST_TIMEOUT_MS = 8_000

export class RepoAccessChecker {
  private readonly access = new Map<string, Promise<boolean>>()

  constructor(private readonly findToken: (args: { userId: string }) => Promise<string>) {}

  require(args: {
    source: EGithubCallSource
    userId: string
    owner: string
    repo: string
    signal?: AbortSignal | undefined
  }): Promise<boolean> {
    args.signal?.throwIfAborted()
    const key = `${args.userId}:${args.owner}/${args.repo}`
    const held = this.access.get(key)
    if (held !== undefined) return held

    const asked = this.check(args).catch((failure: unknown) => {
      this.access.delete(key)
      throw failure
    })
    this.access.set(key, asked)
    return asked
  }

  private async check(args: {
    source: EGithubCallSource
    userId: string
    owner: string
    repo: string
    signal?: AbortSignal | undefined
  }): Promise<boolean> {
    const token = await this.findToken({ userId: args.userId })
    const response = await githubFetch({
      source: args.source,
      url: `https://api.github.com/repos/${args.owner}/${args.repo}`,
      init: {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        signal:
          args.signal === undefined
            ? AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS)
            : AbortSignal.any([args.signal, AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS)]),
      },
    })
    const rateLimit = rateLimitOf(response)
    if (rateLimit !== null) {
      throw new HttpException(
        `github rate limit reached checking access to ${args.owner}/${args.repo} — retry in ${rateLimit.retryAfterSeconds}s`,
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    if (response.status === 401) {
      this.access.delete(`${args.userId}:${args.owner}/${args.repo}`)
      throw new ForbiddenException(
        'the stored github token was rejected (expired or revoked) — reconnect github in settings',
      )
    }
    if (response.status === 404) {
      throw new ForbiddenException(`no access to ${args.owner}/${args.repo}`)
    }
    if (!response.ok) {
      throw new ForbiddenException(
        `github answered ${response.status} checking access to ${args.owner}/${args.repo}`,
      )
    }
    return true
  }
}
