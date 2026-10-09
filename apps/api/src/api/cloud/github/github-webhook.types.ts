import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'

export type GithubPrWebhookRequest = RawBodyRequest<Request>

export interface GithubPrWebhookOutcome {
  handled: boolean
  event: string
  persisted: boolean
}

export interface GithubWebhookRepository {
  full_name: string
}

export interface GithubWebhookPullRequest {
  number: number
  title: string
  html_url: string
  state: string
  draft: boolean
  merged_at: string | null
  head: { ref: string; sha: string; repo: { full_name: string } | null }
}

export interface GithubPullRequestWebhookPayload {
  action: string
  pull_request: GithubWebhookPullRequest
  repository: GithubWebhookRepository
}

export interface GithubCheckSuiteWebhookPayload {
  action: string
  check_suite: { head_sha: string; head_branch: string | null }
  repository: GithubWebhookRepository
}

export interface GithubCheckRunWebhookPayload {
  action: string
  check_run: {
    head_sha: string
    check_suite?: { head_branch?: string | null }
  }
  repository: GithubWebhookRepository
}

export interface GithubPushWebhookPayload {
  ref: string
  repository: GithubWebhookRepository
}

export interface GithubWebhookUser {
  login: string
}

export interface GithubIssueCommentWebhookPayload {
  action: string
  issue: {
    number: number
    html_url: string
    pull_request?: { html_url: string }
  }
  comment: { body: string; html_url: string }
  sender: GithubWebhookUser
  repository: GithubWebhookRepository
}

export interface GithubPullRequestReviewWebhookPayload {
  action: string
  pull_request: GithubWebhookPullRequest
  review: { state: string; body: string | null; html_url: string }
  sender: GithubWebhookUser
  repository: GithubWebhookRepository
}

export interface GithubPullRequestReviewCommentWebhookPayload {
  action: string
  pull_request: GithubWebhookPullRequest
  comment: { body: string; html_url: string }
  sender: GithubWebhookUser
  repository: GithubWebhookRepository
}
