import { Injectable, Logger } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'
import { GithubHeadReads, pullStateOf } from './github-head-reads'
import { GithubPrStateWriter } from './github-pr-state-writer'
import { TransportSelector } from './github-transport-selector'
import type { RestPullRequest } from './github-pull-request-mapping'
import { EGithubCallSource } from './github-call-log'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { threadActivityAt } from './github-thread-activity'
import { liveUntilOf } from './github-delivery-routing'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { normalizedRepo } from './github-pr-identity'
import { GithubRequestCoordinator } from './github-request-coordinator'
import { readRepoTracking } from './github-repo-coverage'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { renewTrackedHeadTargets } from './github-tracked-head-renewal'
import { refreshGithubQueue } from './github-refresh-queue'
import {
  GithubHttpBudgetUnavailable,
  GithubCredentialCooldown,
  withGithubRequestBudget,
  credentialFingerprint,
} from './github-request-budget'
import { GithubUserReadFailed, GithubUserReads } from './github-user-reads'
import type { PullRequestCacheFields } from './github-pull-request-mapping'
import { GithubService } from './github.service'

@Injectable()
export class GithubPollSweeperService {
  private readonly logger = new Logger(GithubPollSweeperService.name)
  private readonly writer: GithubPrStateWriter
  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    private readonly fanout: GithubPrFanoutService,
    private readonly mailbox: GithubPrEventMailboxService,
    private readonly signals: ThreadSignalsService,
    private readonly hooks: GithubHookLifecycleService,
    private readonly coordinator: GithubRequestCoordinator,
    private readonly headReads: GithubHeadReads,
  ) {
    this.writer = new GithubPrStateWriter({
      mailbox: this.mailbox,
      fanout: this.fanout,
      signals: this.signals,
      logger: this.logger,
    })
  }

  async handlePoll(): Promise<void> {
    await this.refreshLiveUntil()
    await renewTrackedHeadTargets({})
    try {
      await withGithubRequestBudget({
        store: this.coordinator,
        run: async () =>
          refreshGithubQueue({
            coordinator: this.coordinator,
            hooks: this.hooks,
            transport: new TransportSelector(readRepoTracking),
            logger: this.logger,
            resolve: (row) => this.resolvePrNumber(row),
            refresh: (target) => this.pollOne(target),
            lookUp: (target) => this.lookUp(target),
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

  private async lookUp(
    target: Row<'GithubTrackingTarget'>,
  ): Promise<'looked-up' | 'skipped' | 'rate-limited' | 'credential-limited'> {
    const token = await this.github.findToken({ userId: target.userId })
    if (token === undefined) return 'skipped'
    try {
      if (target.kind === 'head') {
        await this.recordHeadPulls({ target, token })
      } else if (target.prNumber > 0) {
        const result = await this.pollOne({
          userId: target.userId,
          repoFullName: target.repoFullName,
          prNumber: target.prNumber,
        })
        if (result !== 'polled') return result
      }
    } catch (failure) {
      if (failure instanceof GithubCredentialCooldown) return 'credential-limited'
      if (failure instanceof GithubHttpBudgetUnavailable) return 'rate-limited'
      if (failure instanceof GithubUserReadFailed) {
        return failure.rateLimited ? 'rate-limited' : 'skipped'
      }
      throw failure
    }
    await db.orm.public.GithubTrackingTarget.where({ id: target.id }).update({
      lookedUpAt: new Date(),
    })
    return 'looked-up'
  }

  private async recordHeadPulls(args: {
    target: Row<'GithubTrackingTarget'>
    token: string
  }): Promise<void> {
    const headRepo = normalizedRepo(args.target.repoFullName)
    const parent = await this.headReads.parentOf({ token: args.token, repoFullName: headRepo })
    const repos = parent === null ? [headRepo] : [headRepo, parent]
    for (const repoFullName of repos) {
      const pulls = await this.headReads.pullsByHead({
        token: args.token,
        repoFullName,
        headRepoFullName: headRepo,
        branch: args.target.branch,
      })
      for (const pull of pulls) await this.recordPull({ repoFullName, pull })
    }
  }

  private async recordPull(args: { repoFullName: string; pull: RestPullRequest }): Promise<void> {
    const held = await db.orm.public.GithubPrState.where({
      repoFullName: args.repoFullName,
      prNumber: args.pull.number,
    }).first()
    if (held !== null) return
    await this.writer.recordAndPush({
      repoFullName: args.repoFullName,
      prNumber: args.pull.number,
      fields: {
        title: args.pull.title,
        url: args.pull.html_url,
        state: pullStateOf(args.pull),
        headBranch: args.pull.head.ref,
        headSha: args.pull.head.sha,
        headRepoFullName: args.pull.head.repo?.full_name ?? null,
        checksRunning: 0,
        checksPassed: 0,
        checksFailed: 0,
        checksIgnored: 0,
        checksState: null,
        mergeable: args.pull.mergeable,
        updatedAt: new Date(),
      },
    })
  }

  private async resolvePrNumber(args: Row<'GithubSubscription'>): Promise<number | null> {
    if (args.prNumber !== null || args.branch === '' || args.branch.startsWith('#'))
      return args.prNumber
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return null
    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    try {
      return (
        (
          await this.reads.findOpenPrForBranch({
            source: EGithubCallSource.PollSweep,
            token,
            owner,
            repo,
            branch: args.branch,
          })
        )?.number ?? null
      )
    } catch (failure) {
      if (failure instanceof GithubUserReadFailed && !failure.rateLimited) return null
      throw failure
    }
  }

  private async pollOne(args: {
    userId: string
    repoFullName: string
    prNumber: number
  }): Promise<'polled' | 'skipped' | 'rate-limited' | 'credential-limited'> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return 'skipped'
    const repoFullName = normalizedRepo(args.repoFullName)
    const [owner, repo] = repoFullName.split('/') as [string, string]
    const seenVersion =
      (
        await db.orm.public.GithubPrState.where({
          repoFullName,
          prNumber: args.prNumber,
        }).first()
      )?.version ?? 0
    let fields: PullRequestCacheFields
    try {
      fields = await this.reads.readPullRequest({
        source: EGithubCallSource.PollSweep,
        token,
        owner,
        repo,
        number: args.prNumber,
      })
    } catch (failure) {
      if (failure instanceof GithubCredentialCooldown) return 'credential-limited'
      if (failure instanceof GithubHttpBudgetUnavailable) return 'rate-limited'
      if (failure instanceof GithubUserReadFailed) {
        if (!failure.rateLimited) return 'skipped'
        await this.coordinator.blockHttpUntil({
          until: Date.now() + 60_000,
          credentialFingerprint: credentialFingerprint(token),
          resource: 'core',
        })
        return 'credential-limited'
      }
      throw failure
    }
    const write = await db.transaction((tx) =>
      this.writer.writeState({
        tx,
        repoFullName,
        prNumber: args.prNumber,
        fields: { ...fields, updatedAt: new Date() },
        authoritative: true,
        seenVersion,
      }),
    )
    if (write !== null) await this.writer.publish(write)
    return 'polled'
  }
}
