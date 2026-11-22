import { Injectable, Logger } from '@nestjs/common'
import { and, db, or, type Row } from '@dltech/atlas-db'
import { endSubscriptionsIn } from '@dltech/atlas-control'
import { controlTxOf } from '@dltech/atlas-control/postgres'
import {
  EPrSource,
  ETargetOutcome,
  ETrackingTransport,
  ESubscriptionActor,
  ESubscriptionEnd,
} from '@dltech/atlas-core'
import { GithubHeadReads } from './github-head-reads'
import { applyObservedPull } from './github-pr-observed-pull'
import { GithubPrStore } from './github-pr-store'
import { mergeabilityObservationOfSample, pullObservationOfRest } from './github-pr-observations'
import { TransportSelector } from './github-transport-selector'
import type { RestPullRequest } from './github-pull-request-mapping'
import { EGithubCallSource } from './github-call-log'
import { threadActivityAt } from './github-thread-activity'
import { liveUntilOf } from './github-delivery-routing'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { normalizedRepo } from './github-pr-identity'
import { GithubRequestCoordinator } from './github-request-coordinator'
import { readRepoTracking } from './github-repo-coverage'
import { renewTrackedHeadTargets } from './github-tracked-head-renewal'
import { parkedAttemptOf, refreshGithubQueue, type TargetAttempt } from './github-refresh-queue'
import { ensurePullTarget } from './github-refresh-seed'
import { CLAIM_BATCH } from './github-due-scheduler'
import { withGithubRequestBudget, credentialFingerprint } from './github-request-budget'
import {
  GithubUserReadFailed,
  GithubUserReads,
  type PullObservationRead,
} from './github-user-reads'
import { GithubService } from './github.service'

@Injectable()
export class GithubPollSweeperService {
  private readonly logger = new Logger(GithubPollSweeperService.name)
  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    private readonly hooks: GithubHookLifecycleService,
    private readonly coordinator: GithubRequestCoordinator,
    private readonly headReads: GithubHeadReads,
    private readonly store: GithubPrStore,
  ) {}

  async handlePoll(args: { limit?: number } = {}): Promise<void> {
    await this.refreshLiveUntil()
    await this.endExpired()
    await renewTrackedHeadTargets({})
    try {
      await withGithubRequestBudget({
        store: this.coordinator,
        run: async () =>
          refreshGithubQueue({
            deps: {
              hooks: this.hooks,
              transport: new TransportSelector(readRepoTracking),
              logger: this.logger,
              refresh: (target) => this.pollOne(target),
              lookUp: (target, transport) => this.lookUp({ target, transport }),
            },
            now: new Date(),
            limit: args.limit ?? CLAIM_BATCH,
          }),
      })
    } catch (failure) {
      this.logger.warn(`GitHub refresh queue paused; retrying next sweep: ${String(failure)}`)
    }
  }

  private async refreshLiveUntil(): Promise<void> {
    const linked = await db.orm.public.GithubSubscription.where((subscription) =>
      subscription.threadId.neq(''),
    ).all()
    const activity = await threadActivityAt({
      threadIds: linked.map((subscription) => subscription.threadId),
    })
    for (const subscription of linked) {
      if (subscription.deadline !== null) continue
      const lastActivityAt = activity.get(subscription.threadId)
      if (lastActivityAt === undefined) continue
      const liveUntil = liveUntilOf({
        expiresAt: subscription.expiresAt,
        sandboxLastActivityAt: lastActivityAt,
      })
      if (liveUntil.getTime() > subscription.liveUntil.getTime())
        await db.orm.public.GithubSubscription.where({ id: subscription.id }).update({ liveUntil })
    }
  }

  private async endExpired(): Promise<void> {
    const now = new Date()
    const lapsed = await db.orm.public.GithubSubscription.where((subscription) =>
      subscription.threadId.neq(''),
    )
      .where((subscription) =>
        or(
          subscription.deadline.lt(now),
          and(subscription.expiresAt.lt(now), subscription.liveUntil.lt(now)),
        ),
      )
      .all()
    if (lapsed.length === 0) return
    const at = now.toISOString()
    const ended = await db.transaction((tx) =>
      endSubscriptionsIn({
        tx: controlTxOf(tx),
        rows: lapsed.map((row) => ({ subscriptionId: row.id, threadId: row.threadId })),
        by: ESubscriptionActor.Clock,
        reason: ESubscriptionEnd.Expired,
        at,
        endedBefore: at,
      }),
    )
    if (ended > 0) this.logger.log(`ended ${ended} expired subscriptions`)
  }

  private async lookUp(args: {
    target: Row<'GithubTrackingTarget'>
    transport: ETrackingTransport
  }): Promise<TargetAttempt> {
    const { target } = args
    const token = await this.github.findToken({ userId: target.userId })
    if (token === undefined) return { outcome: ETargetOutcome.CredentialLimited }
    try {
      if (target.kind === 'head') {
        const held = await this.recordHeadPulls({
          target,
          token,
          refreshFound: args.transport === ETrackingTransport.Polled,
        })
        if (held !== undefined) return held
      } else if (target.prNumber > 0) {
        const result = await this.pollOne({
          userId: target.userId,
          repoFullName: target.repoFullName,
          prNumber: target.prNumber,
        })
        if (result.outcome !== ETargetOutcome.Polled) return result
      }
    } catch (failure) {
      return parkedAttemptOf(failure, this.logger)
    }
    await db.orm.public.GithubTrackingTarget.where({ id: target.id }).update({
      lookedUpAt: new Date(),
    })
    return { outcome: ETargetOutcome.LookedUp }
  }

  private async recordHeadPulls(args: {
    target: Row<'GithubTrackingTarget'>
    token: string
    refreshFound: boolean
  }): Promise<TargetAttempt | undefined> {
    const headRepo = normalizedRepo(args.target.repoFullName)
    const parent = await this.headReads.parentOf({ token: args.token, repoFullName: headRepo })
    const repos = parent === null ? [headRepo] : [headRepo, parent]
    let held: TargetAttempt | undefined
    for (const repoFullName of repos) {
      const pulls = await this.headReads.pullsByHead({
        token: args.token,
        repoFullName,
        headRepoFullName: headRepo,
        branch: args.target.branch,
      })
      for (const pull of pulls) {
        await this.recordPull({ repoFullName, pull })
        await ensurePullTarget({
          userId: args.target.userId,
          repoFullName,
          prNumber: pull.number,
          liveUntil: args.target.liveUntil,
          now: new Date(),
        })
        if (!args.refreshFound) continue
        const attempt = await this.pollOne({
          userId: args.target.userId,
          repoFullName,
          prNumber: pull.number,
        })
        if (attempt.outcome !== ETargetOutcome.Polled) held = attempt
      }
    }
    return held
  }

  private async recordPull(args: { repoFullName: string; pull: RestPullRequest }): Promise<void> {
    await this.applyPull({
      repoFullName: args.repoFullName,
      pull: args.pull,
      source: EPrSource.HeadDiscovery,
    })
  }

  private applyPull(args: {
    repoFullName: string
    pull: RestPullRequest
    source: EPrSource
  }): Promise<unknown> {
    const observedAt = new Date().toISOString()
    const observation = pullObservationOfRest({
      repoFullName: args.repoFullName,
      pull: args.pull,
      updatedAt: args.pull.updated_at,
      observedAt,
      source: args.source,
    })
    if (observation === null) {
      this.logger.warn(
        `skipping the pull for ${args.repoFullName}#${args.pull.number}: incomplete fields`,
      )
      return Promise.resolve()
    }

    return this.store.apply({
      repoFullName: args.repoFullName,
      prNumber: args.pull.number,
      observations: [observation],
    })
  }

  private async applyObservedPull(args: {
    repoFullName: string
    read: PullObservationRead
    source: EPrSource
  }): Promise<void> {
    const { read } = args
    const observedAt = read.mergeability.observedAt
    const observation = pullObservationOfRest({
      repoFullName: args.repoFullName,
      pull: read.pull,
      updatedAt: read.pull.updated_at,
      observedAt,
      source: args.source,
    })
    if (observation === null) {
      this.logger.warn(
        `skipping the pull for ${args.repoFullName}#${read.pull.number}: incomplete fields`,
      )
      return
    }
    await applyObservedPull({
      store: this.store,
      repoFullName: args.repoFullName,
      prNumber: read.pull.number,
      observations: [
        observation,
        mergeabilityObservationOfSample({ sample: read.mergeability, source: args.source }),
      ],
      headSha: read.headSha,
      checks: read.checks,
      protection: read.protection,
    })
  }

  private async pollOne(args: {
    userId: string
    repoFullName: string
    prNumber: number
  }): Promise<TargetAttempt> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return { outcome: ETargetOutcome.CredentialLimited }
    const repoFullName = normalizedRepo(args.repoFullName)
    const [owner, repo] = repoFullName.split('/') as [string, string]
    let read: PullObservationRead
    try {
      read = await this.reads.readPullRequestObservation({
        source: EGithubCallSource.PollSweep,
        token,
        owner,
        repo,
        number: args.prNumber,
      })
    } catch (failure) {
      if (failure instanceof GithubUserReadFailed && failure.rateLimited) {
        const until = Date.now() + 60_000
        await this.coordinator.blockHttpUntil({
          until,
          credentialFingerprint: credentialFingerprint(token),
          resource: 'core',
        })
        return { outcome: ETargetOutcome.CredentialLimited, retryAtMs: until }
      }
      return parkedAttemptOf(failure, this.logger)
    }
    await this.applyObservedPull({ repoFullName, read, source: EPrSource.Poll })

    return { outcome: ETargetOutcome.Polled }
  }
}
