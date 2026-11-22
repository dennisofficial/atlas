import { GithubDeliveryChecks } from './github-delivery-checks'
import {
  GithubDeliveryFillDeferred,
  tryRestFill,
  tryRestPull,
  type RestFill,
  type RestPull,
} from './github-delivery-fill'
import { EGithubCallSource } from './github-call-log'
import { EMergeQueueMove, EPrSource } from '@dltech/atlas-core'
import { mergeQueueMoveOfPullAction, notifyMergeQueueMove } from './github-merge-queue-webhook'
import { githubLogOf } from './github-log'
import { normalizedRepo } from './github-pr-identity'
import { inWatchScope } from './github-watch-scope'
import { GithubRequestCoordinator } from './github-request-coordinator'
import { withGithubRequestBudget } from './github-request-budget'
import type { GithubSecretCipher } from './github-ports'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import {
  mergeabilityObservationOfSample,
  pullObservationOfRest,
  pullObservationOfWebhook,
} from './github-pr-observations'
import { refreshAfterBasePush } from './github-delivery-push'
import { applyObservedPull } from './github-pr-observed-pull'
import { GithubPrStore } from './github-pr-store'
import { GithubInstallationTokens } from './github-installation-tokens'
import { GithubFillTokens } from './github-fill-token'
import { GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'
import type {
  GithubCheckRunWebhookPayload,
  GithubCheckSuiteWebhookPayload,
  GithubIssueCommentWebhookPayload,
  GithubPullRequestReviewCommentWebhookPayload,
  GithubPullRequestReviewWebhookPayload,
  GithubPullRequestWebhookPayload,
  GithubPushWebhookPayload,
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

export class GithubDeliveryService {
  private readonly logger = githubLogOf(GithubDeliveryService.name)
  private readonly checks: GithubDeliveryChecks
  private readonly fillTokens: GithubFillTokens

  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    fanout: GithubPrFanoutService,
    _cipher: GithubSecretCipher,
    mailbox: GithubPrEventMailboxService,
    private readonly discussion: GithubPrDiscussionDeliveryService,
    private readonly coordinator: GithubRequestCoordinator,
    private readonly store: GithubPrStore,
    private readonly appTokens?: GithubInstallationTokens,
  ) {
    this.fillTokens = new GithubFillTokens({ github, appTokens })
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

  async applyMergeQueued(args: {
    repoFullName: string
    prNumber: number
    mergeQueued: boolean
  }): Promise<void> {
    await this.store.applyMergeFlags({ ...args, flags: { mergeQueued: args.mergeQueued } })
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

    if (args.event === 'push') {
      await this.handlePush(args.payload as GithubPushWebhookPayload)
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
    const watched = await inWatchScope({
      repoFullName,
      prNumbers: [prNumber],
      heads: [
        { repoFullName, branch: payload.pull_request.head.ref },
        ...(payload.pull_request.head.repo === null
          ? []
          : [
              {
                repoFullName: payload.pull_request.head.repo.full_name,
                branch: payload.pull_request.head.ref,
              },
            ]),
      ],
    })
    if (!watched) return
    const observedAt = new Date().toISOString()
    const observation = pullObservationOfWebhook({ payload, observedAt })
    if (observation !== null) {
      await this.store.apply({ repoFullName, prNumber, observations: [observation] })
    }
    const move = mergeQueueMoveOfPullAction(payload.action)
    await this.store.applyMergeFlags({
      repoFullName,
      prNumber,
      flags: {
        autoMerge: payload.pull_request.auto_merge != null,
        ...(move === null ? {} : { mergeQueued: move === EMergeQueueMove.Entered }),
      },
    })
    if (move !== null) await notifyMergeQueueMove({ repoFullName, prNumber, move })
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
    const restObservedAt = rest.mergeability.observedAt
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
    await applyObservedPull({
      store: this.store,
      repoFullName,
      prNumber,
      observations: [
        restObservation,
        mergeabilityObservationOfSample({
          sample: rest.mergeability,
          source: EPrSource.DeliveryFill,
        }),
      ],
      headSha: rest.headSha,
      checks: rest.checks,
      protection: rest.protection,
    })
  }

  private async handlePush(payload: GithubPushWebhookPayload): Promise<void> {
    const ids = await refreshAfterBasePush({
      repoFullName: normalizedRepo(payload.repository.full_name),
      ref: payload.ref,
      after: payload.after,
    })
    await this.store.dispatch(ids)
  }

  private findFillToken(args: {
    repoFullName: string
    installationId: bigint | undefined
  }): Promise<string | undefined> {
    return this.fillTokens.find(args)
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
