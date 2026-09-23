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

export const OPEN_STATES = ['open', 'draft']

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
    const { owner, repo } = this.parseRepo({ repoFullName: args.repoFullName })
    await this.requireRepoAccess({ userId: args.userId, owner, repo })

    const open = await db.githubPullRequest.findFirst({
      where: {
        repoFullName: args.repoFullName,
        headBranch: args.branch,
        state: { in: OPEN_STATES },
      },
    })
    if (open !== null) return dtoOf(open)

    const filled = await this.fillByBranch({
      owner,
      repo,
      repoFullName: args.repoFullName,
      branch: args.branch,
      settled: false,
    })
    if (filled !== null) return dtoOf(filled)

    const settled = await db.githubPullRequest.findFirst({
      where: { repoFullName: args.repoFullName, headBranch: args.branch },
      orderBy: { updatedAt: 'desc' },
    })
    if (settled !== null) return dtoOf(settled)

    const filledSettled = await this.fillByBranch({
      owner,
      repo,
      repoFullName: args.repoFullName,
      branch: args.branch,
      settled: true,
    })
    return filledSettled === null ? null : dtoOf(filledSettled)
  }

  async readByNumber(args: {
    userId: string
    repoFullName: string
    number: number
  }): Promise<PullRequestDto | null> {
    const { owner, repo } = this.parseRepo({ repoFullName: args.repoFullName })
    await this.requireRepoAccess({ userId: args.userId, owner, repo })

    const cached = await db.githubPullRequest.findUnique({
      where: { repoFullName_number: { repoFullName: args.repoFullName, number: args.number } },
    })
    if (cached !== null) return dtoOf(cached)

    const fields = await this.reads.readPullRequest({ owner, repo, number: args.number })
    const filled = await db.githubPullRequest.upsert({
      where: { repoFullName_number: { repoFullName: args.repoFullName, number: args.number } },
      create: { repoFullName: args.repoFullName, number: args.number, ...fields },
      update: fields,
    })
    return dtoOf(filled)
  }

  private parseRepo(args: { repoFullName: string }): { owner: string; repo: string } {
    const [owner, repo] = args.repoFullName.split('/')
    if (owner === undefined || repo === undefined || args.repoFullName.split('/').length !== 2) {
      throw new ForbiddenException('repo must be owner/name')
    }
    return { owner, repo }
  }

  private async fillByBranch(args: {
    owner: string
    repo: string
    repoFullName: string
    branch: string
    settled: boolean
  }): Promise<CachedRow | null> {
    const found = await this.reads.findPullRequestForBranch({
      owner: args.owner,
      repo: args.repo,
      branch: args.branch,
      settled: args.settled,
    })
    if (found === null) return null

    const fields = await this.reads.readPullRequest({
      owner: args.owner,
      repo: args.repo,
      number: found.number,
    })
    return db.githubPullRequest.upsert({
      where: { repoFullName_number: { repoFullName: args.repoFullName, number: found.number } },
      create: { repoFullName: args.repoFullName, number: found.number, ...fields },
      update: fields,
    })
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
