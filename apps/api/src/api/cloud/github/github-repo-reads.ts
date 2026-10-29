import { Injectable } from '@nestjs/common'
import { githubFetch } from './github-fetch'
import type { GithubRepoSummary } from '@dltech/atlas-wire'
import { GithubUserReadFailed } from './github-user-reads'

const GITHUB_API = 'https://api.github.com'
const DETAIL_CAP = 300
const GITHUB_REQUEST_TIMEOUT_MS = 8_000
const REPOS_QUERY =
  'sort=pushed&direction=desc&per_page=100&affiliation=owner,collaborator,organization_member'

interface RestRepo {
  full_name: string
  private: boolean
  default_branch: string
  pushed_at: string | null
}

interface RestBranch {
  name: string
}

@Injectable()
export class GithubRepoReads {
  private readonly baseUrl = process.env.GITHUB_API_URL ?? GITHUB_API

  async listRepos(args: { token: string }): Promise<GithubRepoSummary[]> {
    const repos = await this.get<RestRepo[]>({
      token: args.token,
      path: `/user/repos?${REPOS_QUERY}`,
    })
    return repos.map((repo) => ({
      fullName: repo.full_name,
      isPrivate: repo.private,
      defaultBranch: repo.default_branch,
      pushedAt: repo.pushed_at,
    }))
  }

  async listBranches(args: { token: string; owner: string; repo: string }): Promise<string[]> {
    const branches = await this.get<RestBranch[]>({
      token: args.token,
      path: `/repos/${args.owner}/${args.repo}/branches?per_page=100`,
    })
    return branches.map((branch) => branch.name)
  }

  private async get<T>(args: { token: string; path: string }): Promise<T> {
    const response = await githubFetch(`${this.baseUrl}${args.path}`, {
      headers: {
        authorization: `Bearer ${args.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
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
}
