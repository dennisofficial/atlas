import type { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'
import { rateLimitOf } from './github-rate-limit'

export const DETAIL_CAP = 300
export const GITHUB_REQUEST_TIMEOUT_MS = 8_000
export const GITHUB_API = 'https://api.github.com'

export const githubApiBaseUrlOf = (): string => process.env.GITHUB_API_URL ?? GITHUB_API

export class GithubUserReadFailed extends Error {
  readonly rateLimited: boolean

  constructor(
    message: string,
    readonly status: number,
    rateLimited?: boolean,
  ) {
    super(message)
    this.rateLimited = rateLimited ?? status === 429
  }
}

export const githubHeadersOf = (args: { token: string }): Record<string, string> => ({
  authorization: `Bearer ${args.token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
})

export const githubJsonGet = async <T>(args: {
  baseUrl: string
  source: EGithubCallSource
  token: string
  path: string
}): Promise<T> => {
  const response = await githubFetch({
    source: args.source,
    url: `${args.baseUrl}${args.path}`,
    init: {
      headers: githubHeadersOf({ token: args.token }),
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
    },
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, DETAIL_CAP)
    throw new GithubUserReadFailed(
      `github answered ${response.status} for ${args.path}: ${detail}`,
      response.status,
      rateLimitOf(response) !== null,
    )
  }
  return (await response.json()) as T
}
