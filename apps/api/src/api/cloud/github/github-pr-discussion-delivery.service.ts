import { Injectable } from '@nestjs/common'
import { and, db, or } from '@dltech/atlas-db'
import { editExcerptOf } from './github-comment-edit-excerpt'
import { subscriptionLiveWhere } from './github-delivery-routing'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { EPrEventKind, type GithubPrEventPayload } from './github-realtime.types'
import type {
  GithubIssueCommentWebhookPayload,
  GithubWebhookCommentChanges,
  GithubPullRequestReviewCommentWebhookPayload,
  GithubPullRequestReviewWebhookPayload,
} from './github-webhook.types'

const RECORDED_REVIEW_STATES = new Set(['approved', 'changes_requested', 'commented'])

function isBodyEdit(payload: { action: string; changes?: GithubWebhookCommentChanges }): boolean {
  return payload.action === 'edited' && payload.changes?.body !== undefined
}

function commentPayloadOf({
  payload,
  edited,
}: {
  payload: GithubIssueCommentWebhookPayload | GithubPullRequestReviewCommentWebhookPayload
  edited: boolean
}): GithubPrEventPayload {
  const { comment } = payload
  const commentId = String(comment.id)
  if (!edited) {
    return {
      url: comment.html_url,
      authorLogin: payload.sender.login,
      body: comment.body,
      commentId,
    }
  }
  return {
    url: comment.html_url,
    authorLogin: comment.user?.login ?? payload.sender.login,
    body: editExcerptOf({
      before: payload.changes?.body?.from,
      after: comment.body,
    }),
    commentId,
    edited: true,
  }
}

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
    if (payload.issue.pull_request === undefined) return
    const edited = isBodyEdit(payload)
    if (payload.action !== 'created' && !edited) return
    await this.recordToSubscribers({
      repoFullName: payload.repository.full_name,
      prNumber: payload.issue.number,
      kind: EPrEventKind.Comment,
      payload: commentPayloadOf({ payload, edited }),
      wake: !edited,
    })
  }

  async handlePullRequestReview(payload: GithubPullRequestReviewWebhookPayload): Promise<void> {
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

  async handleReviewComment(payload: GithubPullRequestReviewCommentWebhookPayload): Promise<void> {
    const edited = isBodyEdit(payload)
    if (payload.action !== 'created' && !edited) return
    await this.recordToSubscribers({
      repoFullName: payload.repository.full_name,
      prNumber: payload.pull_request.number,
      kind: EPrEventKind.ReviewComment,
      payload: {
        ...commentPayloadOf({ payload, edited }),
        headSha: payload.pull_request.head.sha,
      },
      wake: !edited,
    })
  }

  private async recordToSubscribers(args: {
    repoFullName: string
    prNumber: number
    kind: EPrEventKind
    payload: GithubPrEventPayload
    wake?: boolean
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
      ...(args.wake === undefined ? {} : { wake: args.wake }),
    })
  }

  private async resolveSubscribers(args: {
    repoFullName: string
    prNumber: number
  }): Promise<string[]> {
    const subscribers = await db.orm.public.GithubSubscription.where({
      repoFullName: args.repoFullName,
    })
      .where(subscriptionLiveWhere({ now: new Date() }))
      .where((subscription) =>
        or(
          subscription.prNumber.eq(args.prNumber),
          and(subscription.prNumber.isNull(), subscription.branch.neq('')),
        ),
      )
      .all()
    const branches = subscribers
      .filter((subscriber) => subscriber.prNumber === null)
      .map((subscriber) => subscriber.branch)
    if (branches.length === 0) {
      return [...new Set(subscribers.map((subscriber) => subscriber.userId))]
    }

    const head = await db.orm.public.GithubPrState.first({
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
    })
    const matched = subscribers.filter(
      (subscriber) =>
        subscriber.prNumber === args.prNumber ||
        (head !== null && subscriber.branch === head.headBranch),
    )
    return [...new Set(matched.map((subscriber) => subscriber.userId))]
  }
}
