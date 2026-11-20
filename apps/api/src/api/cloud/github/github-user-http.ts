import type { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'
import { rateLimitOfResponse } from './github-rate-limit'

export const DETAIL_CAP = 300
export const GITHUB_REQUEST_TIMEOUT_MS = 8_000
export const GITHUB_API = 'https://api.github.com'
export const GITHUB_RATE_LIMIT_RETRY_MS = 60_000

export class GithubUserReadFailed extends Error {
  readonly rateLimited: boolean

  constructor(
    message: string,
    readonly status: number,
    rateLimited?: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.rateLimited = rateLimited ?? status === 429
  }
}

export const githubRetryAfterMsOf = (headers: Headers): number => {
  const retryAfter = Number(headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter) * 1_000
  const reset = Number(headers.get('x-ratelimit-reset'))
  const now = Date.now()
  if (Number.isFinite(reset) && reset * 1_000 > now) return Math.ceil(reset * 1_000 - now)

  return GITHUB_RATE_LIMIT_RETRY_MS
}

export const githubHeadersOf = (args: { token: string }): Record<string, string> => ({
  authorization: `Bearer ${args.token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
})

export const githubJsonGet = async <T>(args: {
  source: EGithubCallSource
  token: string
  path: string
}): Promise<T> => {
  const response = await githubFetch({
    source: args.source,
    url: `${GITHUB_API}${args.path}`,
    init: {
      headers: githubHeadersOf({ token: args.token }),
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
    },
  })
  if (!response.ok) {
    const limited = (await rateLimitOfResponse(response)) !== null
    const detail = (await response.text()).slice(0, DETAIL_CAP)
    throw new GithubUserReadFailed(
      `github answered ${response.status} for ${args.path}: ${detail}`,
      response.status,
      limited,
      limited ? githubRetryAfterMsOf(response.headers) : undefined,
    )
  }
  return (await response.json()) as T
}
