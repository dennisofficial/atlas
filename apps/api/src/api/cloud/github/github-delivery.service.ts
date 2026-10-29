import { Injectable, Logger } from '@nestjs/common'
import { EGithubCallSource, withGithubCallSource } from './github-call-log'
import { announceSubscriberThreads } from './github-list-signals'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { db, type Row } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { pushPrTransitions } from './github-pr-transition-push'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { payloadFieldsOf } from './github-pr-payload'
import {
  carryChecks,
  provisionalFieldsOf,
  stateFieldsOf,
  type CheckTarget,
} from './github-pr-state-fields'
import {
  branchRoutingOf,
  checkTargetOf,
  dtoOf,
  subscriberWhereOf,
  subscriptionLiveWhere,
} from './github-delivery-routing'
import { type GithubPrStateRecord } from './github-realtime.types'
import type { PrTransitionSnapshot } from './github-pr-event-transitions'
import { GithubUserReadFailed, GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'
import type {
  GithubIssueCommentWebhookPayload,
  GithubPullRequestReviewCommentWebhookPayload,
  GithubPullRequestReviewWebhookPayload,
  GithubPullRequestWebhookPayload,
} from './github-webhook.types'

const HANDLED_EVENTS = new Set([
  'pull_request',
  'check_suite',
  'check_run',
  'push',
  'ping',
  'issue_comment',
  'pull_request_review',
  'pull_request_review_comment',
])

@Injectable()
export class GithubDeliveryService {
  private readonly logger = new Logger(GithubDeliveryService.name)

  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    private readonly fanout: GithubPrFanoutService,
    private readonly cipher: SecretCipherService,
    private readonly mailbox: GithubPrEventMailboxService,
    private readonly discussion: GithubPrDiscussionDeliveryService,
    private readonly signals: ThreadSignalsService,
  ) {}

  async handle(args: { event: string; payload: unknown }): Promise<{ handled: boolean }> {
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

    const target = checkTargetOf({ event: args.event, payload: args.payload })
    if (target !== null) await this.handleCheckTarget(target)
    return { handled: true }
  }

  private async handlePullRequest(payload: GithubPullRequestWebhookPayload): Promise<void> {
    const repoFullName = payload.repository.full_name
    const prNumber = payload.pull_request.number
    const [prior, token] = await Promise.all([
      db.orm.public.GithubPrState.first({ repoFullName, prNumber }),
      this.findFillToken({ repoFullName }),
    ])

    const payloadFields = payloadFieldsOf({ pull: payload.pull_request })
    const recordPayload = this.recordAndPush({
      repoFullName,
      prNumber,
      fields: carryChecks({
        fields: payloadFields,
        prior: prior === null ? null : stateFieldsOf(prior),
      }),
    })

    if (token === undefined) {
      await recordPayload
      return
    }

    const [owner, repo] = repoFullName.split('/') as [string, string]
    const fill = this.tryRestFill({ token, owner, repo, prNumber })
    await recordPayload
    const rest = await fill
    if (rest === null) return
    await this.recordAndPush({ repoFullName, prNumber, fields: rest })
  }

  private async handleCheckTarget(target: CheckTarget): Promise<void> {
    const affected = await this.affectedPrs(target)
    if (affected.length === 0) return

    const token = await this.findFillToken({ repoFullName: target.repoFullName })
    if (token === undefined) return

    const [owner, repo] = target.repoFullName.split('/') as [string, string]
    for (const pr of affected) {
      const fill = this.tryRestFill({ token, owner, repo, prNumber: pr.prNumber })
      await this.recordAndPush({
        repoFullName: target.repoFullName,
        prNumber: pr.prNumber,
        fields: provisionalFieldsOf({ target, prior: stateFieldsOf(pr) }),
      })

      const rest = await fill
      if (rest === null) continue
      await this.recordAndPush({
        repoFullName: target.repoFullName,
        prNumber: pr.prNumber,
        fields: rest,
      })
    }
  }

  private async affectedPrs(target: CheckTarget): Promise<Row<'GithubPrState'>[]> {
    const open = db.orm.public.GithubPrState.where({ repoFullName: target.repoFullName }).where(
      (pr) => pr.state.in(['open', 'draft']),
    )
    const byBranch =
      target.branch === null ? [] : await open.where({ headBranch: target.branch }).all()
    const bySha = target.sha === null ? [] : await open.where({ headSha: target.sha }).all()
    const prs = new Map<number, Row<'GithubPrState'>>()
    for (const row of [...byBranch, ...bySha]) prs.set(row.prNumber, row)
    return [...prs.values()]
  }

  private async findFillToken(args: { repoFullName: string }): Promise<string | undefined> {
    const hook = await db.orm.public.GithubRepoHook.first({ repoFullName: args.repoFullName })
    if (hook !== null) {
      const createdByToken = await this.github.findToken({ userId: hook.createdBy })
      if (createdByToken !== undefined) return createdByToken
    }

    const subscribers = await db.orm.public.GithubSubscription.where({
      repoFullName: args.repoFullName,
    })
      .where(subscriptionLiveWhere({ now: new Date() }))
      .all()
    for (const subscriber of subscribers) {
      const token = await this.github.findToken({ userId: subscriber.userId })
      if (token !== undefined) return token
    }
    return undefined
  }

  private async tryRestFill(args: {
    token: string
    owner: string
    repo: string
    prNumber: number
  }): Promise<GithubPrStateRecord | null> {
    try {
      const fields = await withGithubCallSource({
        source: EGithubCallSource.DeliveryFill,
        run: () =>
          this.reads.readPullRequest({
            token: args.token,
            owner: args.owner,
            repo: args.repo,
            number: args.prNumber,
          }),
      })
      return { ...fields, updatedAt: new Date() }
    } catch (failure) {
      if (
        failure instanceof GithubUserReadFailed &&
        (failure.status === 401 || failure.status === 404)
      ) {
        return null
      }
      this.logger.warn(
        `REST fill for ${args.owner}/${args.repo}#${args.prNumber} failed: ${String(failure)}`,
      )
      return null
    }
  }

  private async recordAndPush(args: {
    repoFullName: string
    prNumber: number
    fields: GithubPrStateRecord
  }): Promise<void> {
    const priorRow = await db.orm.public.GithubPrState.first({
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
    })
    const prior = snapshotOf(priorRow)
    const row = await db.orm.public.GithubPrState.upsert({
      conflictOn: { repoFullName: args.repoFullName, prNumber: args.prNumber },
      create: { repoFullName: args.repoFullName, prNumber: args.prNumber, ...args.fields },
      update: args.fields,
    })

    // Route on the incoming fields rather than the stored row: a row written before the column
    // existed reads NULL (number-routed) even when this delivery knows the head repo, and the
    // fields are never staler than what was just upserted. A delivery that carries no repo
    // (deleted fork, or provisional fields carried forward from an old row) falls back to the
    // row, and NULL stays number-routed — silence over a same-name fork branch leaking frames.
    const subscribers = await db.orm.public.GithubSubscription.where(
      subscriberWhereOf({
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        routing: branchRoutingOf({
          baseRepoFullName: args.repoFullName,
          headBranch: args.fields.headBranch,
          headRepoFullName: args.fields.headRepoFullName ?? row.headRepoFullName,
        }),
      }),
    ).all()
    if (subscribers.length === 0) return

    const state = dtoOf(row)
    const userIds = [...new Set(subscribers.map((subscriber) => subscriber.userId))]
    this.fanout.push({ userIds, state })
    await announceSubscriberThreads({ signals: this.signals, subscribers })

    await pushPrTransitions({ mailbox: this.mailbox, prior, row, userIds })
  }
}

function snapshotOf(row: Row<'GithubPrState'> | null): PrTransitionSnapshot | null {
  if (row === null) return null
  return {
    state: row.state,
    headSha: row.headSha,
    checksRunning: row.checksRunning,
    checksPassed: row.checksPassed,
    checksFailed: row.checksFailed,
    mergeable: row.mergeable,
  }
}
