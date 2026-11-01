import { Injectable, Logger } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'
import { EGithubCallSource } from './github-call-log'
import { announceSubscriberThreads } from './github-list-signals'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { threadActivityAt } from './github-thread-activity'
import { dtoOf, liveUntilOf, subscriberWhereOf } from './github-delivery-routing'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { normalizedRepo, repoPattern } from './github-pr-identity'
import { GithubObservationStore } from './github-observation.store'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { pushPrTransitions, snapshotOf } from './github-pr-transition-push'
import { refreshGithubQueue } from './github-refresh-queue'
import {
  GithubHttpBudgetUnavailable,
  GithubCredentialCooldown,
  withGithubRequestBudget,
  credentialFingerprint,
} from './github-request-budget'
import { GithubUserReadFailed, GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'

@Injectable()
export class GithubPollSweeperService {
  private readonly logger = new Logger(GithubPollSweeperService.name)
  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    private readonly fanout: GithubPrFanoutService,
    private readonly mailbox: GithubPrEventMailboxService,
    private readonly signals: ThreadSignalsService,
    private readonly hooks: GithubHookLifecycleService,
    private readonly observations: GithubObservationStore,
  ) {}

  async handlePoll(): Promise<void> {
    await this.refreshLiveUntil()
    try {
      await withGithubRequestBudget({
        store: this.observations,
        run: () =>
          refreshGithubQueue({
            observations: this.observations,
            hooks: this.hooks,
            logger: this.logger,
            resolve: (row) => this.resolvePrNumber(row),
            refresh: (target) => this.pollOne(target),
          }),
      })
    } catch (failure) {
      this.logger.warn(`GitHub refresh queue paused; retrying next sweep: ${String(failure)}`)
    }
  }

  private async refreshLiveUntil(): Promise<void> {
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
      if (liveUntil.getTime() > subscription.liveUntil.getTime())
        await db.orm.public.GithubSubscription.where({ id: subscription.id }).update({ liveUntil })
    }
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
    let row: Row<'GithubPrState'>
    const prior = snapshotOf(
      await db.orm.public.GithubPrState.where((pr) =>
        pr.repoFullName.ilike(repoPattern(repoFullName)),
      )
        .where({ prNumber: args.prNumber })
        .orderBy((pr) => pr.updatedAt.desc())
        .first(),
    )
    try {
      const fields = await this.reads.readPullRequest({
        source: EGithubCallSource.PollSweep,
        token,
        owner,
        repo,
        number: args.prNumber,
      })
      const normalizedFields = {
        ...fields,
        headRepoFullName:
          fields.headRepoFullName === null ? null : normalizedRepo(fields.headRepoFullName),
      }
      row = await db.orm.public.GithubPrState.upsert({
        conflictOn: { repoFullName, prNumber: args.prNumber },
        create: {
          repoFullName,
          prNumber: args.prNumber,
          ...normalizedFields,
          updatedAt: new Date(),
        },
        update: { ...normalizedFields, updatedAt: new Date() },
      })
    } catch (failure) {
      if (failure instanceof GithubCredentialCooldown) return 'credential-limited'
      if (failure instanceof GithubHttpBudgetUnavailable) return 'rate-limited'
      if (failure instanceof GithubUserReadFailed) {
        if (!failure.rateLimited) return 'skipped'
        await this.observations.blockHttpUntil({
          until: Date.now() + 60_000,
          credentialFingerprint: credentialFingerprint(token),
          resource: 'core',
        })
        return 'credential-limited'
      }
      throw failure
    }
    const subscribers = await db.orm.public.GithubSubscription.where(
      subscriberWhereOf({
        repoFullName,
        prNumber: args.prNumber,
        routing: {
          headBranch: row.headBranch,
          headRepoMatchesBase: row.headRepoFullName === repoFullName,
        },
      }),
    ).all()
    const userIds = [...new Set(subscribers.map((subscriber) => subscriber.userId))]
    const observers = await this.observations.owners({ repoFullName, prNumber: args.prNumber })
    const stateUserIds = [...new Set([...userIds, ...observers])]
    if (stateUserIds.length > 0) this.fanout.push({ userIds: stateUserIds, state: dtoOf(row) })
    if (subscribers.length === 0) return 'polled'
    await announceSubscriberThreads({ signals: this.signals, subscribers })
    await pushPrTransitions({ mailbox: this.mailbox, prior, row, userIds })
    return 'polled'
  }
}
