import { db } from '@dltech/atlas-db'
import {
  type GithubThreadActivity,
  liveUntilOf,
  nextExpiry,
  subscriptionLiveWhere,
} from './github-delivery-routing'
import { cachedPrStates } from './github-linked-prs'
import { GithubAppInstallNoticeService } from './github-app-install-notice.service'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { parseRepo, subscriptionDtoOf } from './github-subscriptions-dto'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { EGithubHttpStatus, GithubHttpError } from './github-http-error'
import type {
  GithubPrStateDto,
  GithubSubscriptionDto,
  GithubSubscribeArgs,
} from './github-realtime.types'
import { GithubRequestCoordinator } from './github-request-coordinator'
import { withGithubRequestBudget } from './github-request-budget'
import { normalizedRepo } from './github-pr-identity'
import { GithubSubscribedPrResolver } from './github-subscribed-pr-resolver'
import { GithubPrStore } from './github-pr-store'
import { GithubSubscribeStateWriter } from './github-subscribe-state-writer'
import { GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'

export class GithubSubscriptionsService {
  private readonly prs: GithubSubscribedPrResolver
  private readonly stateWriter: GithubSubscribeStateWriter

  constructor(
    private readonly github: GithubService,
    reads: GithubUserReads,
    private readonly hooks: GithubHookLifecycleService,
    private readonly installNotice: GithubAppInstallNoticeService,
    private readonly coordinator: GithubRequestCoordinator,
    private readonly installations: GithubAppInstallationsService,
    store: GithubPrStore,
    private readonly activityOf: GithubThreadActivity,
  ) {
    this.prs = new GithubSubscribedPrResolver({ reads, coordinator })
    this.stateWriter = new GithubSubscribeStateWriter({ prs: this.prs, store })
  }

  subscribe(args: GithubSubscribeArgs): Promise<GithubSubscriptionDto> {
    return withGithubRequestBudget({
      store: this.coordinator,
      run: () =>
        this.subscribeAuthorized({ ...args, repoFullName: normalizedRepo(args.repoFullName) }),
    })
  }

  private async subscribeAuthorized(args: GithubSubscribeArgs): Promise<GithubSubscriptionDto> {
    const { owner, repo } = parseRepo({ repoFullName: args.repoFullName })
    const token = await this.requireToken({ userId: args.userId })
    const covered = await this.installations.coversRepo({ repoFullName: args.repoFullName })

    const prNumber = await this.prs.resolvePrNumber({
      userId: args.userId,
      token,
      repoFullName: args.repoFullName,
      owner,
      repo,
      ...(args.prNumber === undefined ? {} : { prNumber: args.prNumber }),
      ...(args.branch === undefined ? {} : { branch: args.branch }),
      ...(args.threadId === undefined ? {} : { threadId: args.threadId }),
    })
    if (prNumber === null && args.branch === undefined) {
      throw new GithubHttpError({
        status: EGithubHttpStatus.NotFound,
        message: 'no such pull request',
      })
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
    const threadId = args.threadId ?? ''
    const expiresAt = nextExpiry()
    const liveUntil = await this.liveCeiling({ threadId, expiresAt })

    const state = await this.stateWriter.pullOnSubscribe({
      userId: args.userId,
      token,
      owner,
      repo,
      repoFullName: args.repoFullName,
      prNumber,
      covered,
    })

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
      },
      conflictOn: {
        userId: args.userId,
        repoFullName: args.repoFullName,
        branch,
        threadId,
      },
    })
    await db.orm.public.GithubRepoHook.where({ repoFullName: args.repoFullName }).updateAndCount({
      idleSince: null,
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
      throw new GithubHttpError({
        status: EGithubHttpStatus.NotFound,
        message: 'no such subscription',
      })
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
      throw new GithubHttpError({
        status: EGithubHttpStatus.NotFound,
        message: 'no such subscription',
      })
    }
    if (args.threadId !== undefined && subscription.threadId !== args.threadId) {
      throw new GithubHttpError({
        status: EGithubHttpStatus.NotFound,
        message: 'no such subscription',
      })
    }
    const expiresAt = nextExpiry()
    const liveUntil = await this.liveCeiling({ threadId: subscription.threadId, expiresAt })
    const updated = await db.orm.public.GithubSubscription.where({ id: subscription.id }).update({
      expiresAt,
      liveUntil,
    })
    if (updated === null)
      throw new GithubHttpError({
        status: EGithubHttpStatus.NotFound,
        message: 'no such subscription',
      })
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
    const polled = new Set(
      subscriptions
        .filter((subscription) => subscription.pollBacked)
        .map(
          (subscription) =>
            `${normalizedRepo(subscription.repoFullName)}#${subscription.prNumber ?? 0}`,
        ),
    )
    if (polled.size === 0)
      return cachedPrStates(
        subscriptions.flatMap((subscription) =>
          subscription.prNumber === null
            ? []
            : [{ repoFullName: subscription.repoFullName, prNumber: subscription.prNumber }],
        ),
      )
    const installUrl = this.installNotice.installUrl()
    const states = await cachedPrStates(
      subscriptions.flatMap((subscription) =>
        subscription.prNumber === null
          ? []
          : [{ repoFullName: subscription.repoFullName, prNumber: subscription.prNumber }],
      ),
    )
    return states.map((state) =>
      polled.has(`${normalizedRepo(state.repoFullName)}#${state.prNumber}`)
        ? {
            ...state,
            polled: true,
            ...(installUrl === null ? {} : { pollingInstallUrl: installUrl }),
          }
        : state,
    )
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

  private async liveCeiling(args: { threadId: string; expiresAt: Date }): Promise<Date> {
    if (args.threadId === '') return args.expiresAt
    const activity = await this.activityOf({ threadIds: [args.threadId] })
    return liveUntilOf({
      expiresAt: args.expiresAt,
      sandboxLastActivityAt: activity.get(args.threadId) ?? null,
    })
  }

  private async requireToken(args: { userId: string }): Promise<string> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) {
      throw new GithubHttpError({
        status: EGithubHttpStatus.Forbidden,
        message: 'connect github to subscribe to pull requests',
      })
    }
    return token
  }
}
