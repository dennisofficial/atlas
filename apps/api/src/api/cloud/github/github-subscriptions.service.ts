import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { EGithubCallSource } from './github-call-log'
import { db } from '@dltech/atlas-db'
import { threadActivityAt } from './github-thread-activity'
import { dtoOf, liveUntilOf, subscriptionLiveWhere } from './github-delivery-routing'
import { GithubAppInstallNoticeService } from './github-app-install-notice.service'
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
    private readonly installNotice: GithubAppInstallNoticeService,
  ) {}

  async subscribe(args: {
    userId: string
    repoFullName: string
    prNumber?: number
    branch?: string
    threadId?: string
  }): Promise<GithubSubscriptionDto> {
    const { owner, repo } = parseRepo({ repoFullName: args.repoFullName })
    await this.access.require({
      source: EGithubCallSource.RepoAccess,
      userId: args.userId,
      owner,
      repo,
    })

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
    const recommendAppInstall = await this.recommendationFor({
      userId: args.userId,
      repoFullName: args.repoFullName,
      pollBacked,
    })
    const branch = args.branch ?? (prNumber === null ? '' : `#${prNumber}`)
    const threadId = args.threadId ?? null
    const expiresAt = nextExpiry()
    const liveUntil = await this.liveCeiling({ threadId, expiresAt })

    const subscription = await db.orm.public.GithubSubscription.upsert({
      create: {
        userId: args.userId,
        repoFullName: args.repoFullName,
        prNumber,
        branch,
        pollBacked,
        expiresAt,
        liveUntil,
        threadId,
      },
      update: {
        prNumber,
        pollBacked,
        expiresAt,
        liveUntil,
        threadId,
      },
      conflictOn: { userId: args.userId, repoFullName: args.repoFullName, branch },
    })
    await db.orm.public.GithubRepoHook.where({ repoFullName: args.repoFullName }).updateAndCount({
      idleSince: null,
    })

    const state = await this.pullOnSubscribe({
      userId: args.userId,
      owner,
      repo,
      repoFullName: args.repoFullName,
      prNumber,
    })

    return subscriptionDtoOf({ subscription, state, recommendAppInstall })
  }

  private async recommendationFor(args: {
    userId: string
    repoFullName: string
    pollBacked: boolean
  }): Promise<{ installUrl: string; repoFullName: string } | undefined> {
    if (!args.pollBacked) return undefined
    const installUrl = this.installNotice.installUrl()
    if (installUrl === null) return undefined
    const recommend = await this.installNotice.shouldRecommend({
      userId: args.userId,
      repoFullName: args.repoFullName,
    })
    return recommend ? { installUrl, repoFullName: args.repoFullName } : undefined
  }

  async dismissAppInstallNotice(args: { userId: string; repoFullName: string }): Promise<void> {
    await this.installNotice.dismiss(args)
  }

  async unsubscribe(args: { userId: string; subscriptionId: string }): Promise<void> {
    const held = await db.orm.public.GithubSubscription.where({ id: args.subscriptionId }).first()
    const removed = await db.orm.public.GithubSubscription.where({
      id: args.subscriptionId,
      userId: args.userId,
    }).deleteAndCount()
    if (removed === 0) {
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
  }): Promise<{ expiresAt: string }> {
    const subscription = await db.orm.public.GithubSubscription.where({
      id: args.subscriptionId,
    }).first()
    if (subscription === null || subscription.userId !== args.userId) {
      throw new NotFoundException('no such subscription')
    }
    const threadId = args.threadId ?? subscription.threadId
    const expiresAt = nextExpiry()
    const liveUntil = await this.liveCeiling({ threadId, expiresAt })
    const updated = await db.orm.public.GithubSubscription.where({ id: subscription.id }).update({
      expiresAt,
      liveUntil,
      ...(args.threadId === undefined ? {} : { threadId: args.threadId }),
    })
    if (updated === null) throw new NotFoundException('no such subscription')
    return { expiresAt: updated.expiresAt.toISOString() }
  }

  async liveSubscriptions(args: {
    userId: string
  }): Promise<Array<{ repoFullName: string; prNumber: number | null; branch: string }>> {
    const rows = await db.orm.public.GithubSubscription.where({ userId: args.userId })
      .where(subscriptionLiveWhere({ now: new Date() }))
      .all()
    return rows.map((row) => ({
      repoFullName: row.repoFullName,
      prNumber: row.prNumber,
      branch: row.branch,
    }))
  }

  async currentStates(args: { userId: string }): Promise<GithubPrStateDto[]> {
    const subscriptions = await db.orm.public.GithubSubscription.where({ userId: args.userId })
      .where((subscription) => subscription.prNumber.isNotNull())
      .where(subscriptionLiveWhere({ now: new Date() }))
      .all()
    const states: GithubPrStateDto[] = []
    for (const subscription of subscriptions) {
      if (subscription.prNumber === null) continue
      const row = await db.orm.public.GithubPrState.where({
        repoFullName: subscription.repoFullName,
        prNumber: subscription.prNumber,
      }).first()
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
    const branch = args.branch
    if (branch === undefined) return null

    const token = await this.requireToken({ userId: args.userId })
    const found = await this.reads.findOpenPrForBranch({
      source: EGithubCallSource.SubscriptionResolve,
      token,
      owner: args.owner,
      repo: args.repo,
      branch,
    })
    if (found !== null) return found.number

    const held = await db.orm.public.GithubSubscription.where({
      userId: args.userId,
      repoFullName: args.repoFullName,
      branch: args.branch,
    }).first()
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
      source: EGithubCallSource.SubscriptionResolve,
      token,
      owner: args.owner,
      repo: args.repo,
      number: args.prNumber,
    })
    const row = await db.orm.public.GithubPrState.upsert({
      conflictOn: { repoFullName: args.repoFullName, prNumber: args.prNumber },
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
        ? await db.orm.public.GithubRepoHook.where({ idleSince: null }).all()
        : await db.orm.public.GithubRepoHook.where({
            idleSince: null,
            repoFullName: args.repoFullName,
          }).all()
    for (const hook of hooks) {
      const live = await db.orm.public.GithubSubscription.where({ repoFullName: hook.repoFullName })
        .where(subscriptionLiveWhere({ now }))
        .all()
      if (live.length === 0) {
        await db.orm.public.GithubRepoHook.where({
          repoFullName: hook.repoFullName,
          idleSince: null,
        }).updateAndCount({ idleSince: now })
      }
    }
  }

  private async liveCeiling(args: { threadId: string | null; expiresAt: Date }): Promise<Date> {
    if (args.threadId === null) return args.expiresAt
    const activity = await threadActivityAt({ threadIds: [args.threadId] })
    return liveUntilOf({
      expiresAt: args.expiresAt,
      sandboxLastActivityAt: activity.get(args.threadId) ?? null,
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
