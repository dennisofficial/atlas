import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { db } from '../../../db'
import { dtoOf, liveUntilOf, subscriptionLiveWhere } from './github-delivery-routing'
import { parseRepo, subscriptionDtoOf } from './github-subscriptions-dto'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { RepoAccessChecker } from './github-repo-access'
import type { GithubPrStateDto, GithubSubscriptionDto } from './github-realtime.types'
import { GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'

const SUBSCRIPTION_TTL_MS = 5 * 60 * 1_000

@Injectable()
export class GithubSubscriptionsService {
  private readonly access = new RepoAccessChecker((args) => this.requireToken(args))

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
    threadId?: string
    sandboxId?: string
  }): Promise<GithubSubscriptionDto> {
    const { owner, repo } = parseRepo({ repoFullName: args.repoFullName })
    await this.access.require({ userId: args.userId, owner, repo })

    const prNumber = await this.resolvePrNumber({
      userId: args.userId,
      repoFullName: args.repoFullName,
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
    const branch = args.branch ?? (prNumber === null ? '' : `#${prNumber}`)
    const threadId = args.threadId ?? null
    const expiresAt = nextExpiry()
    const liveUntil = await this.liveCeiling({ threadId, expiresAt })

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
        expiresAt,
        liveUntil,
        threadId,
        sandboxId: args.sandboxId ?? null,
      },
      update: {
        prNumber,
        pollBacked,
        expiresAt,
        liveUntil,
        threadId,
        sandboxId: args.sandboxId ?? null,
      },
    })
    await db.githubRepoHook.updateMany({
      where: { repoFullName: args.repoFullName },
      data: { idleSince: null },
    })

    const state = await this.pullOnSubscribe({
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
    threadId?: string
    sandboxId?: string
  }): Promise<{ expiresAt: string }> {
    const subscription = await db.githubSubscription.findUnique({
      where: { id: args.subscriptionId },
    })
    if (subscription === null || subscription.userId !== args.userId) {
      throw new NotFoundException('no such subscription')
    }
    const threadId = args.threadId ?? subscription.threadId
    const expiresAt = nextExpiry()
    const liveUntil = await this.liveCeiling({ threadId, expiresAt })
    const updated = await db.githubSubscription.update({
      where: { id: subscription.id },
      data: {
        expiresAt,
        liveUntil,
        ...(args.threadId === undefined ? {} : { threadId: args.threadId }),
        ...(args.sandboxId === undefined ? {} : { sandboxId: args.sandboxId }),
      },
    })
    return { expiresAt: updated.expiresAt.toISOString() }
  }

  async liveSubscriptions(args: {
    userId: string
  }): Promise<Array<{ repoFullName: string; prNumber: number | null; branch: string }>> {
    const rows = await db.githubSubscription.findMany({
      where: {
        userId: args.userId,
        AND: [subscriptionLiveWhere({ now: new Date() })],
      },
    })
    return rows.map((row) => ({
      repoFullName: row.repoFullName,
      prNumber: row.prNumber,
      branch: row.branch,
    }))
  }

  async currentStates(args: { userId: string }): Promise<GithubPrStateDto[]> {
    const subscriptions = await db.githubSubscription.findMany({
      where: {
        userId: args.userId,
        prNumber: { not: null },
        AND: [subscriptionLiveWhere({ now: new Date() })],
      },
    })
    const states: GithubPrStateDto[] = []
    for (const subscription of subscriptions) {
      if (subscription.prNumber === null) continue
      const row = await db.githubPrState.findUnique({
        where: {
          repoFullName_prNumber: {
            repoFullName: subscription.repoFullName,
            prNumber: subscription.prNumber,
          },
        },
      })
      if (row !== null) states.push(dtoOf(row))
    }
    return states
  }

  private async resolvePrNumber(args: {
    userId: string
    repoFullName: string
    owner: string
    repo: string
    prNumber?: number
    branch?: string
  }): Promise<number | null> {
    if (args.prNumber !== undefined) return args.prNumber
    if (args.branch === undefined) return null

    const token = await this.requireToken({ userId: args.userId })
    const found = await this.reads.findOpenPrForBranch({
      token,
      owner: args.owner,
      repo: args.repo,
      branch: args.branch,
    })
    if (found !== null) return found.number

    const held = await db.githubSubscription.findUnique({
      where: {
        userId_repoFullName_branch: {
          userId: args.userId,
          repoFullName: args.repoFullName,
          branch: args.branch,
        },
      },
    })
    return held?.prNumber ?? null
  }

  private async pullOnSubscribe(args: {
    userId: string
    owner: string
    repo: string
    repoFullName: string
    prNumber: number | null
  }): Promise<GithubPrStateDto | null> {
    if (args.prNumber === null) return null
    const token = await this.requireToken({ userId: args.userId })
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
        where: {
          repoFullName: hook.repoFullName,
          AND: [subscriptionLiveWhere({ now })],
        },
      })
      if (live.length === 0) {
        await db.githubRepoHook.updateMany({
          where: { repoFullName: hook.repoFullName, idleSince: null },
          data: { idleSince: now },
        })
      }
    }
  }

  private async liveCeiling(args: {
    threadId: string | null
    expiresAt: Date
  }): Promise<Date> {
    if (args.threadId === null) return args.expiresAt
    const sandbox = await db.cloudSandbox.findUnique({
      where: { threadId: args.threadId },
      select: { lastActivityAt: true },
    })
    return liveUntilOf({
      expiresAt: args.expiresAt,
      sandboxLastActivityAt:
        sandbox === null ? null : new Date(Date.parse(sandbox.lastActivityAt)),
    })
  }

  private async requireToken(args: { userId: string }): Promise<string> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) {
      throw new ForbiddenException('connect github to subscribe to pull requests')
    }
    return token
  }

}

const nextExpiry = () => new Date(Date.now() + SUBSCRIPTION_TTL_MS)
