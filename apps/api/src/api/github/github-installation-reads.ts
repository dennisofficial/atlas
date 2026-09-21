import { Injectable } from '@nestjs/common'
import { GithubAppService } from '../factory/reply/github-app.service'
import type {
  PullRequestCacheFields,
  RestCheckRun,
  RestCommitStatus,
  RestPullRequest,
} from './github-pull-request-mapping'
import { pullRequestCacheFieldsOf } from './github-pull-request-mapping'

const GITHUB_API = 'https://api.github.com'
const DETAIL_CAP = 300

export class GithubRestReadFailed extends Error {}

/**
 * The one GitHub read the webhook flow still needs: webhook payloads carry `mergeable: null`
 * while GitHub computes it, so an event triggers a single REST read for the computed value and
 * the check rollup rather than a poll loop.
 */
@Injectable()
export class GithubInstallationReads {
  constructor(private readonly app: GithubAppService) {}

  async readPullRequest(args: {
    owner: string
    repo: string
    number: number
  }): Promise<PullRequestCacheFields> {
    const token = await this.app.installationToken({ owner: args.owner, repo: args.repo })
    const pull = await this.get<RestPullRequest>({
      token,
      path: `/repos/${args.owner}/${args.repo}/pulls/${args.number}`,
    })
    const checkRuns = await this.get<{ check_runs: RestCheckRun[] }>({
      token,
      path: `/repos/${args.owner}/${args.repo}/commits/${pull.head.sha}/check-runs?per_page=100`,
    })
    const statuses = await this.get<{ statuses: RestCommitStatus[] }>({
      token,
      path: `/repos/${args.owner}/${args.repo}/commits/${pull.head.sha}/status`,
    })

    return pullRequestCacheFieldsOf({
      pull,
      checkRuns: checkRuns.check_runs,
      statuses: statuses.statuses,
    })
  }

  async findOpenPullRequest(args: {
    owner: string
    repo: string
    branch: string
  }): Promise<{ number: number } | null> {
    const token = await this.app.installationToken({ owner: args.owner, repo: args.repo })
    const pulls = await this.get<Array<{ number: number }>>({
      token,
      path: `/repos/${args.owner}/${args.repo}/pulls?state=open&head=${args.owner}:${encodeURIComponent(args.branch)}&per_page=5`,
    })
    const found = pulls[0]
    return found === undefined ? null : { number: found.number }
  }

  private async get<T>(args: { token: string; path: string }): Promise<T> {
    const response = await fetch(`${GITHUB_API}${args.path}`, {
      headers: {
        authorization: `Bearer ${args.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, DETAIL_CAP)
      throw new GithubRestReadFailed(`github answered ${response.status} for ${args.path}: ${detail}`)
    }
    return (await response.json()) as T
  }
}
