import { Injectable } from '@nestjs/common'
import { db } from '../../../db'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { EPrEventKind, type GithubPrEventPayload } from './github-realtime.types'
import type {
  GithubIssueCommentWebhookPayload,
  GithubPullRequestReviewCommentWebhookPayload,
  GithubPullRequestReviewWebhookPayload,
} from './github-webhook.types'

const RECORDED_REVIEW_STATES = new Set(['approved', 'changes_requested', 'commented'])

/**
 * Intake for the conversational webhook classes: issue comments on PRs, submitted reviews, and
 * inline review comments. Each becomes one mailbox row per subscribing user; a delivery that
 * matches nobody is dropped, because a mailbox row for a user with no subscription can never
 * be replayed into a stream they have.
 */
@Injectable()
export class GithubPrDiscussionDeliveryService {
  constructor(private readonly mailbox: GithubPrEventMailboxService) {}

  async handleIssueComment(payload: GithubIssueCommentWebhookPayload): Promise<void> {
    if (payload.action !== 'created') return
    if (payload.issue.pull_request === undefined) return
    await this.recordToSubscribers({
      repoFullName: payload.repository.full_name,
      prNumber: payload.issue.number,
      kind: EPrEventKind.Comment,
      payload: {
        url: payload.comment.html_url,
        authorLogin: payload.sender.login,
        body: payload.comment.body,
        headSha: '',
      },
    })
  }

  async handlePullRequestReview(
    payload: GithubPullRequestReviewWebhookPayload,
  ): Promise<void> {
    if (payload.action !== 'submitted') return
    if (!RECORDED_REVIEW_STATES.has(payload.review.state)) return
    await this.recordToSubscribers({
      repoFullName: payload.repository.full_name,
      prNumber: payload.pull_request.number,
      kind: EPrEventKind.Review,
      payload: {
        url: payload.review.html_url,
        authorLogin: payload.sender.login,
        reviewState: payload.review.state,
        ...(payload.review.body === null ? {} : { body: payload.review.body }),
        headSha: payload.pull_request.head.sha,
      },
    })
  }

  async handleReviewComment(
    payload: GithubPullRequestReviewCommentWebhookPayload,
  ): Promise<void> {
    if (payload.action !== 'created') return
    await this.recordToSubscribers({
      repoFullName: payload.repository.full_name,
      prNumber: payload.pull_request.number,
      kind: EPrEventKind.ReviewComment,
      payload: {
        url: payload.comment.html_url,
        authorLogin: payload.sender.login,
        body: payload.comment.body,
        headSha: payload.pull_request.head.sha,
      },
    })
  }

  private async recordToSubscribers(args: {
    repoFullName: string
    prNumber: number
    kind: EPrEventKind
    payload: GithubPrEventPayload
  }): Promise<void> {
    const userIds = await this.resolveSubscribers({
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
    })
    if (userIds.length === 0) return
    await this.mailbox.record({
      userIds,
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
      kind: args.kind,
      payload: args.payload,
    })
  }

  private async resolveSubscribers(args: {
    repoFullName: string
    prNumber: number
  }): Promise<string[]> {
    const subscribers = await db.githubSubscription.findMany({
      where: {
        repoFullName: args.repoFullName,
        expiresAt: { gt: new Date() },
        OR: [{ prNumber: args.prNumber }, { prNumber: null, branch: { not: '' } }],
      },
    })
    const branches = subscribers
      .filter((subscriber) => subscriber.prNumber === null)
      .map((subscriber) => subscriber.branch)
    if (branches.length === 0) {
      return [...new Set(subscribers.map((subscriber) => subscriber.userId))]
    }

    const head = await db.githubPrState.findUnique({
      where: {
        repoFullName_prNumber: { repoFullName: args.repoFullName, prNumber: args.prNumber },
      },
    })
    const matched = subscribers.filter(
      (subscriber) =>
        subscriber.prNumber === args.prNumber ||
        (head !== null && subscriber.branch === head.headBranch),
    )
    return [...new Set(matched.map((subscriber) => subscriber.userId))]
  }
}
