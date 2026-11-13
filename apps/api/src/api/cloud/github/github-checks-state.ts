import type { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'

const GITHUB_API = 'https://api.github.com'
const GITHUB_REQUEST_TIMEOUT_MS = 8_000

const CHECKS_STATE_QUERY = `query ($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) { statusCheckRollup { state } } }
}`

type ChecksStateBody = {
  data?: {
    repository?: {
      pullRequest?: { statusCheckRollup?: { state?: string | null } | null } | null
    } | null
  } | null
  errors?: unknown
}

/**
 * GitHub's own rollup state for one pull request, in the wire's vocabulary. A rollup is absent on
 * many repos and no caller can act on a failure here, so every unhappy path answers null and the
 * state writer keeps the value it already holds.
 */
export async function readChecksState(args: {
  source: EGithubCallSource
  token: string
  owner: string
  repo: string
  number: number
  baseUrl?: string
}): Promise<string | null> {
  try {
    const response = await githubFetch({
      source: args.source,
      url: `${args.baseUrl ?? process.env.GITHUB_API_URL ?? GITHUB_API}/graphql`,
      init: {
        method: 'POST',
        headers: {
          authorization: `Bearer ${args.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          query: CHECKS_STATE_QUERY,
          variables: { owner: args.owner, repo: args.repo, number: args.number },
        }),
      },
    })
    if (!response.ok) return null
    const body = (await response.json()) as ChecksStateBody
    if (body.errors !== undefined) return null
    const state = body.data?.repository?.pullRequest?.statusCheckRollup?.state
    return typeof state === 'string' ? state.toLowerCase() : null
  } catch {
    return null
  }
}
