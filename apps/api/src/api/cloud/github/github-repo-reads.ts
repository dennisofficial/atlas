import { Injectable } from '@nestjs/common'
import type { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'
import {
  ERepoTreeEntryKind,
  type GithubRepoSummary,
  type ProjectRepoTree,
} from '@dltech/atlas-wire'
import { GithubUserReadFailed } from './github-user-reads'

const GITHUB_API = 'https://api.github.com'
const HTTP_CONFLICT = 409
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

interface RestTree {
  sha: string
  tree: { path: string; type: string; sha: string }[]
  truncated: boolean
}

interface RestBlob {
  content: string
  encoding: string
}

export type RepoTreeSnapshot = {
  sha: string
  entries: { path: string; kind: ERepoTreeEntryKind; sha: string }[]
  truncated: boolean
}

const TREE_KINDS: Record<string, ERepoTreeEntryKind> = {
  blob: ERepoTreeEntryKind.File,
  tree: ERepoTreeEntryKind.Folder,
}

@Injectable()
export class GithubRepoReads {
  private readonly baseUrl = process.env.GITHUB_API_URL ?? GITHUB_API

  async listRepos(args: {
    source: EGithubCallSource
    token: string
  }): Promise<GithubRepoSummary[]> {
    const repos = await this.get<RestRepo[]>({
      source: args.source,
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

  async listBranches(args: {
    source: EGithubCallSource
    token: string
    owner: string
    repo: string
  }): Promise<string[]> {
    const branches = await this.get<RestBranch[]>({
      source: args.source,
      token: args.token,
      path: `/repos/${args.owner}/${args.repo}/branches?per_page=100`,
    })
    return branches.map((branch) => branch.name)
  }

  async listTree(args: {
    source: EGithubCallSource
    token: string
    owner: string
    repo: string
    ref: string
  }): Promise<ProjectRepoTree> {
    const snapshot = await this.listTreeSnapshot(args)
    return {
      entries: snapshot.entries.map(({ path, kind }) => ({ path, kind })),
      truncated: snapshot.truncated,
    }
  }

  async listTreeSnapshot(args: {
    source: EGithubCallSource
    token: string
    owner: string
    repo: string
    ref: string
  }): Promise<RepoTreeSnapshot> {
    const ref = args.ref.split('/').map(encodeURIComponent).join('/')
    const result = await this.get<RestTree>({
      source: args.source,
      token: args.token,
      path: `/repos/${args.owner}/${args.repo}/git/trees/${ref}?recursive=1`,
    }).catch((failure: unknown) => {
      if (failure instanceof GithubUserReadFailed && failure.status === HTTP_CONFLICT) return null
      throw failure
    })
    if (result === null) return { sha: '', entries: [], truncated: false }
    return {
      sha: result.sha,
      entries: result.tree.flatMap((entry) => {
        const kind = TREE_KINDS[entry.type]
        return kind === undefined ? [] : [{ path: entry.path, kind, sha: entry.sha }]
      }),
      truncated: result.truncated,
    }
  }

  async readBlob(args: {
    source: EGithubCallSource
    token: string
    owner: string
    repo: string
    sha: string
  }): Promise<string> {
    const blob = await this.get<RestBlob>({
      source: args.source,
      token: args.token,
      path: `/repos/${args.owner}/${args.repo}/git/blobs/${args.sha}`,
    })
    if (blob.encoding !== 'base64') {
      throw new GithubUserReadFailed(`github sent a ${blob.encoding} blob`, 502)
    }
    return Buffer.from(blob.content, 'base64').toString('utf8')
  }

  private async get<T>(args: {
    source: EGithubCallSource
    token: string
    path: string
  }): Promise<T> {
    const response = await githubFetch({
      source: args.source,
      url: `${this.baseUrl}${args.path}`,
      init: {
        headers: {
          authorization: `Bearer ${args.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      },
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
