import { Injectable } from '@nestjs/common'
import type {
  PullRequestCacheFields,
  RestCheckRun,
  RestCommitStatus,
  RestPullRequest,
} from './github-pull-request-mapping'
import { pullRequestCacheFieldsOf } from './github-pull-request-mapping'

const GITHUB_API = 'https://api.github.com'
const DETAIL_CAP = 300

export class GithubUserReadFailed extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export type CreateHookResult =
  | { outcome: 'created'; hookId: number }
  | { outcome: 'adopted'; hookId: number | undefined }
  | { outcome: 'forbidden' }

export interface HookConfig {
  url: string
  secret: string
}

/**
 * Every GitHub call in the realtime flow is made as a specific user's OAuth token — the API
 * holds no credential of its own. Injectable so the base URL is test-overridable.
 */
@Injectable()
export class GithubUserReads {
  private readonly baseUrl = process.env.GITHUB_API_URL ?? GITHUB_API

  async readPullRequest(args: {
    token: string
    owner: string
    repo: string
    number: number
  }): Promise<PullRequestCacheFields> {
    const pull = await this.get<RestPullRequest>({
      token: args.token,
      path: `/repos/${args.owner}/${args.repo}/pulls/${args.number}`,
    })
    const checkRuns = await this.get<{ check_runs: RestCheckRun[] }>({
      token: args.token,
      path: `/repos/${args.owner}/${args.repo}/commits/${pull.head.sha}/check-runs?per_page=100`,
    })
    const statuses = await this.get<{ statuses: RestCommitStatus[] }>({
      token: args.token,
      path: `/repos/${args.owner}/${args.repo}/commits/${pull.head.sha}/status`,
    })

    return pullRequestCacheFieldsOf({
      pull,
      checkRuns: checkRuns.check_runs,
      statuses: statuses.statuses,
    })
  }

  /**
   * The branch-side of subscribe: the tracked checkout knows a branch, not a number, so this
   * resolves the open PR for it as the subscribing user. `head=owner:branch` is required — a
   * bare branch matches only same-repo heads and misses forks.
   */
  async findOpenPrForBranch(args: {
    token: string
    owner: string
    repo: string
    branch: string
  }): Promise<{ number: number } | null> {
    const head = `${args.owner}:${encodeURIComponent(args.branch)}`
    const pulls = await this.get<Array<{ number: number }>>({
      token: args.token,
      path: `/repos/${args.owner}/${args.repo}/pulls?state=open&head=${head}&per_page=5`,
    })
    const found = pulls[0]
    return found === undefined ? null : { number: found.number }
  }

  async createHook(args: {
    token: string
    owner: string
    repo: string
    config: HookConfig
  }): Promise<CreateHookResult> {
    const response = await fetch(`${this.baseUrl}/repos/${args.owner}/${args.repo}/hooks`, {
      method: 'POST',
      headers: this.headers({ token: args.token }),
      body: JSON.stringify({
        name: 'web',
        active: true,
        events: ['pull_request', 'check_suite', 'check_run', 'push'],
        config: {
          url: args.config.url,
          content_type: 'json',
          secret: args.config.secret,
        },
      }),
    })
    if (response.ok) {
      const body = (await response.json()) as { id?: number }
      if (body.id === undefined) throw new GithubUserReadFailed('hook created without an id', 500)
      return { outcome: 'created', hookId: body.id }
    }
    if (response.status === 422) return { outcome: 'adopted', hookId: await this.findHookId(args) }
    if (response.status === 403 || response.status === 404) return { outcome: 'forbidden' }
    const detail = (await response.text()).slice(0, DETAIL_CAP)
    throw new GithubUserReadFailed(
      `github answered ${response.status} creating a hook: ${detail}`,
      response.status,
    )
  }

  async getHook(args: {
    token: string
    owner: string
    repo: string
    hookId: number
  }): Promise<'found' | 'missing' | 'unauthorized'> {
    const response = await fetch(
      `${this.baseUrl}/repos/${args.owner}/${args.repo}/hooks/${args.hookId}`,
      { headers: this.headers({ token: args.token }) },
    )
    if (response.ok) return 'found'
    if (response.status === 404) return 'missing'
    if (response.status === 401 || response.status === 403) return 'unauthorized'
    const detail = (await response.text()).slice(0, DETAIL_CAP)
    throw new GithubUserReadFailed(
      `github answered ${response.status} reading hook ${args.hookId}: ${detail}`,
      response.status,
    )
  }

  async deleteHook(args: {
    token: string
    owner: string
    repo: string
    hookId: number
  }): Promise<'deleted' | 'unauthorized'> {
    const response = await fetch(
      `${this.baseUrl}/repos/${args.owner}/${args.repo}/hooks/${args.hookId}`,
      { method: 'DELETE', headers: this.headers({ token: args.token }) },
    )
    if (response.ok || response.status === 404) return 'deleted'
    if (response.status === 401 || response.status === 403) return 'unauthorized'
    const detail = (await response.text()).slice(0, DETAIL_CAP)
    throw new GithubUserReadFailed(
      `github answered ${response.status} deleting hook ${args.hookId}: ${detail}`,
      response.status,
    )
  }

  private async findHookId(args: {
    token: string
    owner: string
    repo: string
    config: HookConfig
  }): Promise<number | undefined> {
    const hooks = await this.get<Array<{ id: number; config?: { url?: string } }>>({
      token: args.token,
      path: `/repos/${args.owner}/${args.repo}/hooks?per_page=100`,
    })
    return hooks.find((hook) => hook.config?.url === args.config.url)?.id
  }

  private async get<T>(args: { token: string; path: string }): Promise<T> {
    const response = await fetch(`${this.baseUrl}${args.path}`, {
      headers: this.headers({ token: args.token }),
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, DETAIL_CAP)
      throw new GithubUserReadFailed(
        `github answered ${response.status} for ${args.path}: ${detail}`,
        response.status,
      )
    }
    return (await response.json()) as T
  }

  private headers(args: { token: string }): Record<string, string> {
    return {
      authorization: `Bearer ${args.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    }
  }
}
