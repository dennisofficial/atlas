import { Injectable } from '@nestjs/common'
import { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'
import { rateLimitOf } from './github-rate-limit'
import type { RestPullRequest } from './github-pull-request-mapping'
import { GithubUserReadFailed } from './github-user-reads'
import { GITHUB_API } from './github-user-http'

const DETAIL_CAP = 300
const REQUEST_TIMEOUT_MS = 8_000
const MAX_PULLS = 100

export type RepoMeta = { fork: boolean; parent: string | null }

export const pullStateOf = (pull: RestPullRequest): string => {
  if (pull.merged_at !== null) return 'merged'
  if (pull.state === 'closed') return 'closed'
  return pull.draft ? 'draft' : 'open'
}

@Injectable()
export class GithubHeadReads {
  private readonly parents = new Map<string, string | null>()

  async pullsByHead(args: {
    token: string
    repoFullName: string
    headRepoFullName: string
    branch: string
  }): Promise<RestPullRequest[]> {
    const [owner] = args.headRepoFullName.split('/') as [string, string]
    const head = `${owner}:${encodeURIComponent(args.branch)}`
    return this.get<RestPullRequest[]>({
      token: args.token,
      path: `/repos/${args.repoFullName}/pulls?state=all&head=${head}&per_page=${MAX_PULLS}`,
    })
  }

  async parentOf(args: { token: string; repoFullName: string }): Promise<string | null> {
    const held = this.parents.get(args.repoFullName)
    if (held !== undefined) return held
    const meta = await this.get<{ fork?: boolean; parent?: { full_name?: string } | null }>({
      token: args.token,
      path: `/repos/${args.repoFullName}`,
    })
    const parent = meta.fork === true ? (meta.parent?.full_name ?? null) : null
    this.parents.set(args.repoFullName, parent)
    return parent
  }

  private async get<T>(args: { token: string; path: string }): Promise<T> {
    const response = await githubFetch({
      source: EGithubCallSource.PollSweep,
      url: `${GITHUB_API}${args.path}`,
      init: {
        headers: {
          authorization: `Bearer ${args.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
}
