import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { db } from '../../../db'
import { dtoOf } from './github-delivery.service'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import type { GithubPrStateDto, GithubSubscriptionDto } from './github-realtime.types'
import { GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'

const SUBSCRIPTION_TTL_MS = 5 * 60 * 1_000

@Injectable()
export class GithubSubscriptionsService {
  private readonly access = new Map<string, Promise<boolean>>()

  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    private readonly hooks: GithubHookLifecycleService,
  ) {}

  async subscribe(args: {
    userId: string
    repoFullName: string
    prNumber?: number
    branch?: string
  }): Promise<GithubSubscriptionDto> {
    const { owner, repo } = parseRepo({ repoFullName: args.repoFullName })
    await this.requireRepoAccess({ userId: args.userId, owner, repo })

    const prNumber = await this.resolvePrNumber({
      userId: args.userId,
      owner,
      repo,
      ...(args.prNumber === undefined ? {} : { prNumber: args.prNumber }),
      ...(args.branch === undefined ? {} : { branch: args.branch }),
    })
    if (prNumber === null && args.branch === undefined) {
      throw new NotFoundException('no such pull request')
    }

    const hook = await this.hooks.ensureHook({
      userId: args.userId,
      repoFullName: args.repoFullName,
    })
    const pollBacked = hook === 'poll-backed'
    const branch = args.branch ?? ''

    const subscription = await db.githubSubscription.upsert({
      where: {
        userId_repoFullName_branch: {
          userId: args.userId,
          repoFullName: args.repoFullName,
          branch,
        },
      },
      create: {
        userId: args.userId,
        repoFullName: args.repoFullName,
        prNumber,
        branch,
        pollBacked,
        expiresAt: nextExpiry(),
      },
      update: { prNumber, pollBacked, expiresAt: nextExpiry() },
    })
    await db.githubRepoHook.updateMany({
      where: { repoFullName: args.repoFullName },
      data: { idleSince: null },
    })

    const state =
      prNumber === null
        ? null
        : await this.pullOnSubscribe({
            userId: args.userId,
            owner,
            repo,
            repoFullName: args.repoFullName,
            prNumber,
          })

    return subscriptionDtoOf({ subscription, state })
  }

  async unsubscribe(args: { userId: string; subscriptionId: string }): Promise<void> {
    const held = await db.githubSubscription.findUnique({ where: { id: args.subscriptionId } })
    const removed = await db.githubSubscription.deleteMany({
      where: { id: args.subscriptionId, userId: args.userId },
    })
    if (removed.count === 0) {
      throw new NotFoundException('no such subscription')
    }
    if (held !== null) {
      await this.markIdleWhenDrained({ repoFullName: held.repoFullName })
    }
  }

  async heartbeat(args: {
    userId: string
    subscriptionId: string
  }): Promise<{ expiresAt: string }> {
    const subscription = await db.githubSubscription.findUnique({
      where: { id: args.subscriptionId },
    })
    if (subscription === null || subscription.userId !== args.userId) {
      throw new NotFoundException('no such subscription')
    }
    const updated = await db.githubSubscription.update({
      where: { id: subscription.id },
      data: { expiresAt: nextExpiry() },
    })
    return { expiresAt: updated.expiresAt.toISOString() }
  }

  async liveSubscriptions(args: {
    userId: string
  }): Promise<Array<{ repoFullName: string; prNumber: number | null; branch: string }>> {
    const rows = await db.githubSubscription.findMany({
      where: { userId: args.userId, expiresAt: { gt: new Date() } },
    })
    return rows.map((row) => ({
      repoFullName: row.repoFullName,
      prNumber: row.prNumber,
      branch: row.branch,
    }))
  }

  /**
   * A number is authoritative already; a branch resolves to its open PR as the subscribing
   * user. The DTO guarantees exactly one is set, so the only null is "no open PR on that branch".
   */
  private async resolvePrNumber(args: {
    userId: string
    owner: string
    repo: string
    prNumber?: number
    branch?: string
  }): Promise<number | null> {
    if (args.prNumber !== undefined) return args.prNumber
    if (args.branch === undefined) return null

    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) {
      throw new ForbiddenException('connect github to subscribe to pull requests')
    }
    const found = await this.reads.findOpenPrForBranch({
      token,
      owner: args.owner,
      repo: args.repo,
      branch: args.branch,
    })
    return found === null ? null : found.number
  }

  private async pullOnSubscribe(args: {
    userId: string
    owner: string
    repo: string
    repoFullName: string
    prNumber: number
  }): Promise<GithubPrStateDto | null> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) {
      throw new ForbiddenException('connect github to subscribe to pull requests')
    }
    const fields = await this.reads.readPullRequest({
      token,
      owner: args.owner,
      repo: args.repo,
      number: args.prNumber,
    })
    const row = await db.githubPrState.upsert({
      where: {
        repoFullName_prNumber: { repoFullName: args.repoFullName, prNumber: args.prNumber },
      },
      create: {
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        ...fields,
        updatedAt: new Date(),
      },
      update: { ...fields, updatedAt: new Date() },
    })
    return dtoOf(row)
  }

  async markIdleWhenDrained(args: { repoFullName?: string }): Promise<void> {
    const now = new Date()
    const hooks =
      args.repoFullName === undefined
        ? await db.githubRepoHook.findMany({ where: { idleSince: null } })
        : await db.githubRepoHook.findMany({
            where: { idleSince: null, repoFullName: args.repoFullName },
          })
    for (const hook of hooks) {
      const live = await db.githubSubscription.findMany({
        where: { repoFullName: hook.repoFullName, expiresAt: { gt: now } },
      })
      if (live.length === 0) {
        await db.githubRepoHook.updateMany({
          where: { repoFullName: hook.repoFullName, idleSince: null },
          data: { idleSince: now },
        })
      }
    }
  }

  /**
   * The caller's own OAuth token is the access proof: GitHub answering 200 for the repo means
   * this user may see its PR state. Cached per connection — membership does not flip often
   * enough to re-ask on every subscribe.
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
      throw new ForbiddenException('connect github to subscribe to pull requests')
    }

    const response = await fetch(`https://api.github.com/repos/${args.owner}/${args.repo}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    })
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

function parseRepo(args: { repoFullName: string }): { owner: string; repo: string } {
  const [owner, repo] = args.repoFullName.split('/')
  if (owner === undefined || repo === undefined || args.repoFullName.split('/').length !== 2) {
    throw new ForbiddenException('repo must be owner/name')
  }
  return { owner, repo }
}

function nextExpiry(): Date {
  return new Date(Date.now() + SUBSCRIPTION_TTL_MS)
}

function subscriptionDtoOf(args: {
  subscription: {
    id: string
    repoFullName: string
    prNumber: number | null
    branch: string
    pollBacked: boolean
    expiresAt: Date
  }
  state: GithubPrStateDto | null
}): GithubSubscriptionDto {
  return {
    id: args.subscription.id,
    repoFullName: args.subscription.repoFullName,
    prNumber: args.subscription.prNumber,
    branch: args.subscription.branch,
    pollBacked: args.subscription.pollBacked,
    expiresAt: args.subscription.expiresAt.toISOString(),
    state: args.state,
  }
}
