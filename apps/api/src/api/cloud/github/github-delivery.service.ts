import { Injectable, Logger } from '@nestjs/common'
import { GithubDeliveryChecks } from './github-delivery-checks'
import { GithubDeliveryFillDeferred, tryRestFill, type RestFill } from './github-delivery-fill'
import { normalizedRepo, repoPattern } from './github-pr-identity'
import { GithubObservationStore } from './github-observation.store'
import { withGithubRequestBudget } from './github-request-budget'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { payloadFieldsOf } from './github-pr-payload'
import { GithubPrStateWriter } from './github-pr-state-writer'
import { carryChecks, stateFieldsOf } from './github-pr-state-fields'
import { subscriptionLiveWhere } from './github-delivery-routing'
import { GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'
import type {
  GithubCheckRunWebhookPayload,
  GithubIssueCommentWebhookPayload,
  GithubPullRequestReviewCommentWebhookPayload,
  GithubPullRequestReviewWebhookPayload,
  GithubPullRequestWebhookPayload,
  GithubStatusWebhookPayload,
} from './github-webhook.types'

const HEAD_ACTIONS = new Set(['opened', 'reopened', 'synchronize'])

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
  private readonly writer: GithubPrStateWriter
  private readonly checks: GithubDeliveryChecks

  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    fanout: GithubPrFanoutService,
    _cipher: SecretCipherService,
    mailbox: GithubPrEventMailboxService,
    private readonly discussion: GithubPrDiscussionDeliveryService,
    signals: ThreadSignalsService,
    private readonly observations: GithubObservationStore,
  ) {
    this.writer = new GithubPrStateWriter({
      mailbox,
      fanout,
      signals,
      observations,
      logger: this.logger,
    })
    this.checks = new GithubDeliveryChecks({
      writer: this.writer,
      restFill: async (args) => {
        const token = await this.findFillToken({
          repoFullName: args.repoFullName,
        })
        if (token === undefined) return { kind: 'skipped' }
        const [owner, repo] = args.repoFullName.split('/') as [string, string]
        return this.restFill({ token, owner, repo, prNumber: args.prNumber })
      },
    })
  }

  handle(args: {
    event: string
    payload: unknown
    replay?: boolean
  }): Promise<{ handled: boolean }> {
    return withGithubRequestBudget({
      store: this.observations,
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

    if (args.event === 'pull_request') {
      await this.handlePullRequest(args.payload as GithubPullRequestWebhookPayload)
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
      await this.checks.handleCheckRun(args.payload as GithubCheckRunWebhookPayload)
    }
    if (args.event === 'status') {
      await this.checks.handleStatus(args.payload as GithubStatusWebhookPayload)
    }
    return { handled: true }
  }

  private async handlePullRequest(payload: GithubPullRequestWebhookPayload): Promise<void> {
    const repoFullName = normalizedRepo(payload.repository.full_name)
    const prNumber = payload.pull_request.number
    const [prior, token] = await Promise.all([
      db.orm.public.GithubPrState.where((pr) => pr.repoFullName.ilike(repoPattern(repoFullName)))
        .where({ prNumber })
        .orderBy((pr) => pr.updatedAt.desc())
        .first(),
      this.findFillToken({ repoFullName }),
    ])

    const headMoves = HEAD_ACTIONS.has(payload.action)
    const payloadFields = payloadFieldsOf({ pull: payload.pull_request })
    const recordPayload = this.writer.recordAndPush({
      repoFullName,
      prNumber,
      fields: carryChecks({
        fields: payloadFields,
        prior: prior === null ? null : stateFieldsOf(prior),
      }),
    })

    if (token === undefined || !headMoves) {
      await recordPayload
      return
    }

    const [owner, repo] = repoFullName.split('/') as [string, string]
    const fill = this.restFill({ token, owner, repo, prNumber })
    await recordPayload
    const rest = await fill
    if (rest.kind === 'deferred') {
      throw new GithubDeliveryFillDeferred({
        repoFullName,
        prNumbers: [prNumber],
      })
    }
    if (rest.kind === 'skipped') return
    await this.writer.recordAndPush({
      repoFullName,
      prNumber,
      fields: rest.fields,
    })
  }

  private async findFillToken(args: { repoFullName: string }): Promise<string | undefined> {
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
    for (const userId of await this.observations.repoOwners(args).catch(() => [])) {
      const token = await this.github.findToken({ userId })
      if (token !== undefined) return token
    }
    return undefined
  }

  private restFill(args: {
    token: string
    owner: string
    repo: string
    prNumber: number
  }): Promise<RestFill> {
    return tryRestFill({ reads: this.reads, logger: this.logger, ...args })
  }
}
