import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common'
import type { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'
import { rateLimitOf } from './github-rate-limit'
import { ACCESS_PROOF_DENIAL_TTL_MS, ACCESS_PROOF_TTL_MS } from './github-request-coordinator.types'

const GITHUB_REQUEST_TIMEOUT_MS = 8_000

type AccessOutcome =
  | { verdict: 'granted' }
  | { verdict: 'denied'; failure: ForbiddenException }
  | { verdict: 'failed'; failure: unknown }

type HeldDenial = { failure: ForbiddenException; expiresAt: number }

type AccessArgs = {
  source: EGithubCallSource
  userId: string
  owner: string
  repo: string
  signal?: AbortSignal | undefined
}

export class RepoAccessChecker {
  private readonly inFlight = new Map<string, Promise<boolean>>()
  private readonly grants = new Map<string, number>()
  private readonly denials = new Map<string, HeldDenial>()

  constructor(private readonly findToken: (args: { userId: string }) => Promise<string>) {}

  require(args: AccessArgs): Promise<boolean> {
    args.signal?.throwIfAborted()
    const key = `${args.userId}:${args.owner}/${args.repo}`
    const grantedUntil = this.grants.get(key)
    if (grantedUntil !== undefined && grantedUntil > Date.now()) return Promise.resolve(true)
    const denial = this.denials.get(key)
    if (denial !== undefined && denial.expiresAt > Date.now()) return Promise.reject(denial.failure)
    this.grants.delete(key)
    this.denials.delete(key)

    const asking = this.inFlight.get(key)
    if (asking !== undefined) return asking

    const asked = this.check(args).then((outcome) => {
      this.inFlight.delete(key)
      if (outcome.verdict === 'granted') {
        this.grants.set(key, Date.now() + ACCESS_PROOF_TTL_MS)
        return true
      }
      if (outcome.verdict === 'denied') {
        this.denials.set(key, {
          failure: outcome.failure,
          expiresAt: Date.now() + ACCESS_PROOF_DENIAL_TTL_MS,
        })
      }
      throw outcome.failure
    })
    this.inFlight.set(key, asked)
    return asked
  }

  private async check(args: AccessArgs): Promise<AccessOutcome> {
    let response: Response
    try {
      const token = await this.findToken({ userId: args.userId })
      response = await githubFetch({
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
    } catch (failure) {
      return { verdict: 'failed', failure }
    }
    const rateLimit = rateLimitOf(response)
    if (rateLimit !== null) {
      return {
        verdict: 'failed',
        failure: new HttpException(
          `github rate limit reached checking access to ${args.owner}/${args.repo} — retry in ${rateLimit.retryAfterSeconds}s`,
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      }
    }
    if (response.status === 401) {
      return {
        verdict: 'failed',
        failure: new ForbiddenException(
          'the stored github token was rejected (expired or revoked) — reconnect github in settings',
        ),
      }
    }
    if (response.status === 404) {
      return {
        verdict: 'denied',
        failure: new ForbiddenException(`no access to ${args.owner}/${args.repo}`),
      }
    }
    if (!response.ok) {
      const failure = new ForbiddenException(
        `github answered ${response.status} checking access to ${args.owner}/${args.repo}`,
      )
      return response.status === 403
        ? { verdict: 'denied', failure }
        : { verdict: 'failed', failure }
    }
    return { verdict: 'granted' }
  }
}
