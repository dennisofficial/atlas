import { ForbiddenException, Injectable } from '@nestjs/common'
import { db } from '../../../db'
import { GithubInstallationReads } from './github-installation-reads'
import { GithubService } from './github.service'

export interface PullRequestDto {
  repoFullName: string
  number: number
  title: string
  url: string
  state: string
  headBranch: string
  headSha: string
  checks: { running: number; passed: number; failed: number }
  mergeable: boolean | null
  mergeableState: string | null
  updatedAt: string
}

type CachedRow = {
  repoFullName: string
  number: number
  title: string
  url: string
  state: string
  headBranch: string
  headSha: string
  checksRunning: number
  checksPassed: number
  checksFailed: number
  mergeable: boolean | null
  mergeableState: string | null
  updatedAt: Date
}

const OPEN_STATES = ['open', 'draft']

const dtoOf = (row: CachedRow): PullRequestDto => ({
  repoFullName: row.repoFullName,
  number: row.number,
  title: row.title,
  url: row.url,
  state: row.state,
  headBranch: row.headBranch,
  headSha: row.headSha,
  checks: {
    running: row.checksRunning,
    passed: row.checksPassed,
    failed: row.checksFailed,
  },
  mergeable: row.mergeable,
  mergeableState: row.mergeableState,
  updatedAt: row.updatedAt.toISOString(),
})

@Injectable()
export class PullRequestsService {
  private readonly access = new Map<string, Promise<boolean>>()

  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubInstallationReads,
  ) {}

  async readByBranch(args: {
    userId: string
    repoFullName: string
    branch: string
  }): Promise<PullRequestDto | null> {
    const [owner, repo] = args.repoFullName.split('/')
    if (owner === undefined || repo === undefined || args.repoFullName.split('/').length !== 2) {
      throw new ForbiddenException('repo must be owner/name')
    }
    await this.requireRepoAccess({ userId: args.userId, owner, repo })

    const cached = await db.githubPullRequest.findFirst({
      where: {
        repoFullName: args.repoFullName,
        headBranch: args.branch,
        state: { in: OPEN_STATES },
      },
    })
    if (cached !== null) return dtoOf(cached)

    const found = await this.reads.findOpenPullRequest({
      owner,
      repo,
      branch: args.branch,
    })
    if (found === null) return null

    const fields = await this.reads.readPullRequest({ owner, repo, number: found.number })
    const created = await db.githubPullRequest.upsert({
      where: { repoFullName_number: { repoFullName: args.repoFullName, number: found.number } },
      create: { repoFullName: args.repoFullName, number: found.number, ...fields },
      update: fields,
    })
    return dtoOf(created)
  }

  /**
   * The caller's own device-flow GitHub token is the access proof: GitHub answering 200 for the
   * repo means this user may see its PR state. The answer is cached per connection — repo
   * membership does not flip often enough to re-ask on every read.
   */
  private requireRepoAccess(args: {
    userId: string
    owner: string
    repo: string
  }): Promise<boolean> {
    const key = `${args.userId}:${args.owner}/${args.repo}`
    const held = this.access.get(key)
    if (held !== undefined) return held

    const asked = this.checkRepoAccess(args).catch((failure: unknown) => {
      this.access.delete(key)
      throw failure
    })
    this.access.set(key, asked)
    return asked
  }

  private async checkRepoAccess(args: {
    userId: string
    owner: string
    repo: string
  }): Promise<boolean> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) {
      throw new ForbiddenException('connect github to read pull requests')
    }

    const response = await fetch(
      `https://api.github.com/repos/${args.owner}/${args.repo}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
      },
    )
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
