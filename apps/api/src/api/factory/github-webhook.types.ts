import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'
import type { EFactoryEventKind } from './factory.types'

export type GithubWebhookRequest = RawBodyRequest<Request>

export interface GithubWebhookOutcome {
  handled: boolean
  workItemId?: string
  kind?: EFactoryEventKind
  appended?: boolean
}

export interface GithubRepository {
  full_name: string
}

export interface GithubActor {
  login: string
}

export interface GithubIssue {
  number: number
  // GitHub fires issue_comment for PR conversation comments too; a pull_request key marks them.
  pull_request?: Record<string, unknown>
}

export interface GithubIssueLabel {
  name: string
}

export interface GithubIssuesEventPayload {
  action: string
  issue: GithubIssue
  label?: GithubIssueLabel
  repository: GithubRepository
  sender: GithubActor
}

export interface GithubComment {
  author_association: string
  // Present when the comment was written through a GitHub App — the offline echo signal.
  performed_via_github_app?: { id: number; slug: string } | null
}

export interface GithubIssueCommentEventPayload {
  action: string
  issue: GithubIssue
  comment: GithubComment
  repository: GithubRepository
  sender: GithubActor
}

export interface GithubReview {
  author_association: string
}

export interface GithubPullRequestReviewEventPayload {
  action: string
  pull_request: GithubPullRequest
  review: GithubReview
  repository: GithubRepository
  sender: GithubActor
}

export interface GithubPullRequestReviewCommentEventPayload {
  action: string
  pull_request: GithubPullRequest
  comment: GithubComment
  repository: GithubRepository
  sender: GithubActor
}

export interface GithubPullRequest {
  number: number
  merged: boolean
}

export interface GithubPullRequestEventPayload {
  action: string
  pull_request: GithubPullRequest
  repository: GithubRepository
  sender: GithubActor
}
