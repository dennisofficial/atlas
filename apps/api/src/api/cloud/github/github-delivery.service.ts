import { Injectable, Logger } from '@nestjs/common'
import { GithubDeliveryChecks } from './github-delivery-checks'
import {
  GithubDeliveryFillDeferred,
  tryRestFill,
  tryRestPull,
  type RestFill,
  type RestPull,
} from './github-delivery-fill'
import { EGithubCallSource } from './github-call-log'
import { EPrSource } from '@dltech/atlas-core'
import { normalizedRepo, repoPattern } from './github-pr-identity'
import { GithubRequestCoordinator } from './github-request-coordinator'
import { withGithubRequestBudget } from './github-request-budget'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import {
  pullObservationOfRest,
  mergeabilityObservationOf,
  pullObservationOfWebhook,
} from './github-pr-observations'
import { GithubPrStore } from './github-pr-store'
import { GithubInstallationTokens } from './github-installation-tokens'
import { subscriptionLiveWhere } from './github-delivery-routing'
import { GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'
import type {
  GithubCheckRunWebhookPayload,
  GithubCheckSuiteWebhookPayload,
  GithubIssueCommentWebhookPayload,
  GithubPullRequestReviewCommentWebhookPayload,
  GithubPullRequestReviewWebhookPayload,
  GithubPullRequestWebhookPayload,
  GithubStatusWebhookPayload,
} from './github-webhook.types'

const HEAD_ACTIONS = new Set(['opened', 'reopened', 'synchronize'])

const installationIdOf = (payload: unknown): bigint | undefined => {
  const id = (payload as { installation?: { id?: unknown } }).installation?.id
  return typeof id === 'number' ? BigInt(id) : undefined
}

const HANDLED_EVENTS = new Set([
  'pull_request',
  'check_suite',
  'check_run',
  'push',
  'status',
  'ping',
  'issue_comment',
  'pull_request_review',
  'pull_request_review_comment',
])

@Injectable()
export class GithubDeliveryService {
  private readonly logger = new Logger(GithubDeliveryService.name)
  private readonly checks: GithubDeliveryChecks

  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    fanout: GithubPrFanoutService,
    _cipher: SecretCipherService,
    mailbox: GithubPrEventMailboxService,
    private readonly discussion: GithubPrDiscussionDeliveryService,
    signals: ThreadSignalsService,
    private readonly coordinator: GithubRequestCoordinator,
    private readonly store: GithubPrStore,
    private readonly appTokens?: GithubInstallationTokens,
  ) {
    this.checks = new GithubDeliveryChecks({
      store: this.store,
      restFill: async (args) => {
        const token = await this.findFillToken({
          repoFullName: args.repoFullName,
          installationId: args.installationId,
        })
        if (token === undefined) return { kind: 'skipped' }
        const [owner, repo] = args.repoFullName.split('/') as [string, string]
        return this.restFill({ token, owner, repo, prNumber: args.prNumber })
      },
      fetchAnnotations: async (args) => {
        const token = await this.findFillToken({
          repoFullName: args.repoFullName,
          installationId: args.installationId,
        })
        if (token === undefined) return null
        const [owner, repo] = args.repoFullName.split('/') as [string, string]
        return this.reads.readCheckAnnotations({
          source: EGithubCallSource.CheckAnnotations,
          token,
          owner,
          repo,
          checkRunId: args.checkRunId,
        })
      },
    })
  }

  handle(args: {
    event: string
    payload: unknown
    replay?: boolean
  }): Promise<{ handled: boolean }> {
    return withGithubRequestBudget({
      store: this.coordinator,
      run: () => this.handleWithinBudget(args),
    })
  }

  private async handleWithinBudget(args: {
    event: string
    payload: unknown
    replay?: boolean
  }): Promise<{ handled: boolean }> {
    if (!HANDLED_EVENTS.has(args.event)) return { handled: false }
    if (args.event === 'ping') return { handled: true }

    const installationId = installationIdOf(args.payload)

    if (args.event === 'pull_request') {
      await this.handlePullRequest(args.payload as GithubPullRequestWebhookPayload, installationId)
      return { handled: true }
    }
    if (args.event === 'issue_comment') {
      await this.discussion.handleIssueComment(args.payload as GithubIssueCommentWebhookPayload)
      return { handled: true }
    }
    if (args.event === 'pull_request_review') {
      await this.discussion.handlePullRequestReview(
        args.payload as GithubPullRequestReviewWebhookPayload,
      )
      return { handled: true }
    }
    if (args.event === 'pull_request_review_comment') {
      await this.discussion.handleReviewComment(
        args.payload as GithubPullRequestReviewCommentWebhookPayload,
      )
      return { handled: true }
    }

    if (args.event === 'check_run') {
      await this.checks.handleCheckRun(args.payload as GithubCheckRunWebhookPayload, installationId)
    }
    if (args.event === 'check_suite') {
      await this.checks.handleCheckSuite(
        args.payload as GithubCheckSuiteWebhookPayload,
        installationId,
      )
    }
    if (args.event === 'status') {
      await this.checks.handleStatus(args.payload as GithubStatusWebhookPayload, installationId)
    }
    return { handled: true }
  }

  private async handlePullRequest(
    payload: GithubPullRequestWebhookPayload,
    installationId: bigint | undefined,
  ): Promise<void> {
    const repoFullName = normalizedRepo(payload.repository.full_name)
    const prNumber = payload.pull_request.number
    const observedAt = new Date().toISOString()
    const observation = pullObservationOfWebhook({ payload, observedAt })
    if (observation !== null) {
      await this.store.apply({ repoFullName, prNumber, observations: [observation] })
    }
    if (!HEAD_ACTIONS.has(payload.action)) return
    const token = await this.findFillToken({ repoFullName, installationId })
    if (token === undefined) return

    const [owner, repo] = repoFullName.split('/') as [string, string]
    const rest = await this.restPull({ token, owner, repo, prNumber })
    if (rest.kind === 'deferred') {
      throw new GithubDeliveryFillDeferred({
        repoFullName,
        prNumbers: [prNumber],
      })
    }
    if (rest.kind === 'skipped') return
    const restObservedAt = new Date().toISOString()
    const restObservation = pullObservationOfRest({
      repoFullName,
      pull: rest.pull,
      updatedAt: rest.pull.updated_at,
      observedAt: restObservedAt,
      source: EPrSource.DeliveryFill,
    })
    if (restObservation === null) {
      this.logger.warn(`skipping the REST pull for ${repoFullName}#${prNumber}: incomplete fields`)
      return
    }
    await this.store.apply({
      repoFullName,
      prNumber,
      observations: [
        restObservation,
        mergeabilityObservationOf({
          pull: rest.pull,
          observedAt: restObservedAt,
          source: EPrSource.DeliveryFill,
        }),
      ],
    })
  }

  private async findFillToken(args: {
    repoFullName: string
    installationId: bigint | undefined
  }): Promise<string | undefined> {
    const appToken = await this.appInstallationToken(args)
    if (appToken !== undefined) return appToken

    const hook = await db.orm.public.GithubRepoHook.where((hook) =>
      hook.repoFullName.ilike(repoPattern(args.repoFullName)),
    ).first()
    if (hook !== null) {
      const createdByToken = await this.github.findToken({
        userId: hook.createdBy,
      })
      if (createdByToken !== undefined) return createdByToken
    }

    const subscribers = await db.orm.public.GithubSubscription.where((subscription) =>
      subscription.repoFullName.ilike(repoPattern(args.repoFullName)),
    )
      .where(subscriptionLiveWhere({ now: new Date() }))
      .all()
    for (const subscriber of subscribers) {
      const token = await this.github.findToken({ userId: subscriber.userId })
      if (token !== undefined) return token
    }
    return undefined
  }

  private appInstallationToken(args: {
    repoFullName: string
    installationId: bigint | undefined
  }): Promise<string | undefined> {
    if (this.appTokens === undefined) return Promise.resolve(undefined)
    return args.installationId === undefined
      ? this.appTokens.tokenForRepo({ repoFullName: args.repoFullName })
      : this.appTokens.tokenForInstallation({ installationId: args.installationId })
  }

  private restFill(args: {
    token: string
    owner: string
    repo: string
    prNumber: number
  }): Promise<RestFill> {
    return tryRestFill({ reads: this.reads, logger: this.logger, ...args })
  }

  private restPull(args: {
    token: string
    owner: string
    repo: string
    prNumber: number
  }): Promise<RestPull> {
    return tryRestPull({ reads: this.reads, logger: this.logger, ...args })
  }
}
