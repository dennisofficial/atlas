import { Injectable, Logger } from '@nestjs/common'
import { EGithubCallSource } from './github-call-log'
import { announceSubscriberThreads } from './github-list-signals'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { db, type Row } from '@dltech/atlas-db'
import { threadActivityAt } from './github-thread-activity'
import {
  dtoOf,
  liveUntilOf,
  subscriberWhereOf,
  subscriptionLiveWhere,
} from './github-delivery-routing'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { pushPrTransitions, snapshotOf } from './github-pr-transition-push'
import type { PrTransitionSnapshot } from './github-pr-event-transitions'
import type { GithubBranchRouting, GithubPrStateDto } from './github-realtime.types'
import { GithubUserReadFailed, GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'

/**
 * A delivered webhook rewrites the state row and bumps `updatedAt`, so a hook-backed PR whose
 * row is younger than this is provably tracked — skip it. A missing or older row means a
 * delivery was lost (deploy kill, 5xx, throttle) or never arrived, and the only thing that
 * heals it is a REST read: GitHub does not retry failed webhook deliveries on its own.
 */
const REANCHOR_AFTER_MS = 10 * 60 * 1_000

@Injectable()
export class GithubPollSweeperService {
  private readonly logger = new Logger(GithubPollSweeperService.name)

  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    private readonly fanout: GithubPrFanoutService,
    private readonly mailbox: GithubPrEventMailboxService,
    private readonly signals: ThreadSignalsService,
  ) {}

  async handlePoll(): Promise<void> {
    const now = new Date()

    await this.refreshLiveUntil({ now })

    const repos = await db.orm.public.GithubRepoHook.where({ idleSince: null }).all()
    for (const hook of repos) {
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
    const pollBacked = await db.orm.public.GithubSubscription.where({ pollBacked: true })
      .where(subscriptionLiveWhere({ now }))
      .all()
    for (const subscription of pollBacked) {
      const prNumber = await this.resolvePrNumber({
        subscriptionId: subscription.id,
        userId: subscription.userId,
        repoFullName: subscription.repoFullName,
        prNumber: subscription.prNumber,
        branch: subscription.branch,
      })
      if (prNumber === null) continue
      await this.pollOne({
        userId: subscription.userId,
        repoFullName: subscription.repoFullName,
        prNumber,
      })
    }

    const hookBacked = await db.orm.public.GithubSubscription.where({ pollBacked: false })
      .where((subscription) => subscription.prNumber.isNotNull())
      .where(subscriptionLiveWhere({ now }))
      .all()
    for (const subscription of hookBacked) {
      if (subscription.prNumber === null) continue
      const state = await db.orm.public.GithubPrState.first({
        repoFullName: subscription.repoFullName,
        prNumber: subscription.prNumber,
      })
      if (state !== null && now.getTime() - state.updatedAt.getTime() < REANCHOR_AFTER_MS) {
        continue
      }
      await this.pollOne({
        userId: subscription.userId,
        repoFullName: subscription.repoFullName,
        prNumber: subscription.prNumber,
      })
    }
  }

  /**
   * Recomputes the materialized liveness ceiling for thread-linked subscriptions from their
   * sandbox's current lastActivityAt, so sandbox activity keeps a parked-linked row live without
   * heartbeats. Rows whose liveUntil already covers the same ceiling are untouched.
   */
  private async refreshLiveUntil(args: { now: Date }): Promise<void> {
    const linked = await db.orm.public.GithubSubscription.where((subscription) =>
      subscription.threadId.isNotNull(),
    ).all()
    const activity = await threadActivityAt({
      threadIds: linked.flatMap((subscription) =>
        subscription.threadId === null ? [] : [subscription.threadId],
      ),
    })
    for (const subscription of linked) {
      const lastActivityAt =
        subscription.threadId === null ? undefined : activity.get(subscription.threadId)
      if (lastActivityAt === undefined) continue
      const liveUntil = liveUntilOf({
        expiresAt: subscription.expiresAt,
        sandboxLastActivityAt: lastActivityAt,
      })
      if (liveUntil.getTime() <= subscription.liveUntil.getTime()) continue
      await db.orm.public.GithubSubscription.where({ id: subscription.id }).update({ liveUntil })
    }
  }

  private async resolvePrNumber(args: {
    subscriptionId: string
    userId: string
    repoFullName: string
    prNumber: number | null
    branch: string
  }): Promise<number | null> {
    // A '#' branch is the number-keyed sentinel, not a real branch — nothing to re-resolve.
    if (args.prNumber !== null || args.branch === '' || args.branch.startsWith('#')) {
      return args.prNumber
    }

    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return null

    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    let found: { number: number } | null
    try {
      found = await this.reads.findOpenPrForBranch({
        source: EGithubCallSource.PollSweep,
        token,
        owner,
        repo,
        branch: args.branch,
      })
    } catch (failure) {
      if (failure instanceof GithubUserReadFailed) return null
      throw failure
    }
    if (found === null) return null

    await db.orm.public.GithubSubscription.where({ id: args.subscriptionId }).update({
      prNumber: found.number,
    })
    return found.number
  }

  private async pollOne(args: {
    userId: string
    repoFullName: string
    prNumber: number
  }): Promise<void> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return

    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    let pushed: {
      state: GithubPrStateDto
      routing: GithubBranchRouting
      row: Row<'GithubPrState'>
      prior: PrTransitionSnapshot | null
    }
    try {
      const fields = await this.reads.readPullRequest({
        source: EGithubCallSource.PollSweep,
        token,
        owner,
        repo,
        number: args.prNumber,
      })
      const prior = snapshotOf(
        await db.orm.public.GithubPrState.first({
          repoFullName: args.repoFullName,
          prNumber: args.prNumber,
        }),
      )
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
      pushed = {
        state: dtoOf(row),
        routing: {
          headBranch: fields.headBranch,
          headRepoMatchesBase: fields.headRepoFullName === args.repoFullName,
        },
        row,
        prior,
      }
    } catch (failure) {
      if (failure instanceof GithubUserReadFailed) return
      throw failure
    }

    const subscribers = await db.orm.public.GithubSubscription.where(
      subscriberWhereOf({
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        routing: pushed.routing,
      }),
    ).all()
    if (subscribers.length === 0) return

    const userIds = [...new Set(subscribers.map((subscriber) => subscriber.userId))]
    this.fanout.push({ userIds, state: pushed.state })
    await announceSubscriberThreads({ signals: this.signals, subscribers })
    await pushPrTransitions({
      mailbox: this.mailbox,
      prior: pushed.prior,
      row: pushed.row,
      userIds,
    })
  }
}
