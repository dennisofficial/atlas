import { Injectable, Logger } from '@nestjs/common'
import { EFactoryAliasKind, EFactoryEventKind, EFactorySurface, EFactoryWorkItemStatus } from './factory.types'
import type {
  GithubIssueCommentEventPayload,
  GithubIssuesEventPayload,
  GithubPullRequestEventPayload,
  GithubPullRequestReviewCommentEventPayload,
  GithubPullRequestReviewEventPayload,
  GithubWebhookOutcome,
} from './github-webhook.types'
import { TranscriptService } from './transcript.service'
import { WorkItemsService } from './work-items.service'

const FACTORY_LABEL = 'atlas-factory'
const NOT_HANDLED: GithubWebhookOutcome = { handled: false }

function issueExternalId(args: { repo: string; issueNumber: number }): string {
  return `${args.repo}#${args.issueNumber}`
}

function pullRequestExternalId(args: { repo: string; pullNumber: number }): string {
  return `${args.repo}/pull/${args.pullNumber}`
}

@Injectable()
export class GithubWebhookService {
  private readonly logger = new Logger(GithubWebhookService.name)

  constructor(
    private readonly workItems: WorkItemsService,
    private readonly transcript: TranscriptService,
  ) {}

  async handle(args: { event: string; deliveryId: string; payload: unknown }): Promise<GithubWebhookOutcome> {
    switch (args.event) {
      case 'ping':
        return { handled: true }
      case 'issues':
        return this.handleIssues({
          deliveryId: args.deliveryId,
          payload: args.payload as GithubIssuesEventPayload,
        })
      case 'issue_comment':
        return this.handleIssueComment({
          deliveryId: args.deliveryId,
          payload: args.payload as GithubIssueCommentEventPayload,
        })
      case 'pull_request_review':
        return this.handlePullRequestReview({
          deliveryId: args.deliveryId,
          payload: args.payload as GithubPullRequestReviewEventPayload,
        })
      case 'pull_request_review_comment':
        return this.handlePullRequestReviewComment({
          deliveryId: args.deliveryId,
          payload: args.payload as GithubPullRequestReviewCommentEventPayload,
        })
      case 'pull_request':
        return this.handlePullRequest({
          deliveryId: args.deliveryId,
          payload: args.payload as GithubPullRequestEventPayload,
        })
      default:
        this.logger.log(`ignored unsupported github event: ${args.event}`)
        return NOT_HANDLED
    }
  }

  private async handleIssues(args: {
    deliveryId: string
    payload: GithubIssuesEventPayload
  }): Promise<GithubWebhookOutcome> {
    const { payload } = args
    const externalId = issueExternalId({ repo: payload.repository.full_name, issueNumber: payload.issue.number })

    if (payload.action === 'labeled' && payload.label?.name === FACTORY_LABEL) {
      const { created } = await this.workItems.intake({
        repo: payload.repository.full_name,
        sourceKind: EFactorySurface.GitHub,
        surface: EFactorySurface.GitHub,
        externalId,
        aliasKind: EFactoryAliasKind.Issue,
      })
      return this.append({
        externalId,
        deliveryId: args.deliveryId,
        kind: created ? EFactoryEventKind.Intake : EFactoryEventKind.StatusChange,
        author: payload.sender.login,
        payload,
      })
    }

    return this.append({
      externalId,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.StatusChange,
      author: payload.sender.login,
      payload,
    })
  }

  private async handleIssueComment(args: {
    deliveryId: string
    payload: GithubIssueCommentEventPayload
  }): Promise<GithubWebhookOutcome> {
    const { payload } = args
    if (payload.action !== 'created') return NOT_HANDLED

    const externalId =
      payload.issue.pull_request === undefined
        ? issueExternalId({ repo: payload.repository.full_name, issueNumber: payload.issue.number })
        : pullRequestExternalId({ repo: payload.repository.full_name, pullNumber: payload.issue.number })
    return this.append({
      externalId,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.Comment,
      author: payload.sender.login,
      authorAssociation: payload.comment.author_association,
      payload,
    })
  }

  private async handlePullRequestReview(args: {
    deliveryId: string
    payload: GithubPullRequestReviewEventPayload
  }): Promise<GithubWebhookOutcome> {
    const { payload } = args
    if (payload.action !== 'submitted') return NOT_HANDLED

    const externalId = pullRequestExternalId({
      repo: payload.repository.full_name,
      pullNumber: payload.pull_request.number,
    })
    return this.append({
      externalId,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.Review,
      author: payload.sender.login,
      authorAssociation: payload.review.author_association,
      payload,
    })
  }

  private async handlePullRequestReviewComment(args: {
    deliveryId: string
    payload: GithubPullRequestReviewCommentEventPayload
  }): Promise<GithubWebhookOutcome> {
    const { payload } = args
    if (payload.action !== 'created') return NOT_HANDLED

    const externalId = pullRequestExternalId({
      repo: payload.repository.full_name,
      pullNumber: payload.pull_request.number,
    })
    return this.append({
      externalId,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.Review,
      author: payload.sender.login,
      authorAssociation: payload.comment.author_association,
      payload,
    })
  }

  private async handlePullRequest(args: {
    deliveryId: string
    payload: GithubPullRequestEventPayload
  }): Promise<GithubWebhookOutcome> {
    const { payload } = args
    if (payload.action !== 'closed' || !payload.pull_request.merged) return NOT_HANDLED

    const externalId = pullRequestExternalId({
      repo: payload.repository.full_name,
      pullNumber: payload.pull_request.number,
    })
    const outcome = await this.append({
      externalId,
      deliveryId: args.deliveryId,
      kind: EFactoryEventKind.Merged,
      author: payload.sender.login,
      payload,
    })
    if (outcome.workItemId !== undefined && outcome.appended === true) {
      await this.workItems.transition({ workItemId: outcome.workItemId, status: EFactoryWorkItemStatus.Merged })
    }
    return outcome
  }

  private async append(args: {
    externalId: string
    deliveryId: string
    kind: EFactoryEventKind
    author: string
    payload: unknown
    authorAssociation?: string
  }): Promise<GithubWebhookOutcome> {
    const result = await this.transcript.append({
      surface: EFactorySurface.GitHub,
      externalId: args.externalId,
      deliveryId: args.deliveryId,
      kind: args.kind,
      author: args.author,
      authorAssociation: args.authorAssociation?.toLowerCase(),
      payload: JSON.stringify(args.payload),
    })
    if (result === null) {
      this.logger.log(`dropped github event for untracked surface: ${args.externalId}`)
      return NOT_HANDLED
    }
    return { handled: true, workItemId: result.workItemId, kind: args.kind, appended: result.appended }
  }
}
