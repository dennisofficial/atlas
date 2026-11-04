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
  check_suite: {
    id?: number
    status?: string | null
    updated_at?: string | null
    app?: { slug: string } | null
    head_sha: string
    head_branch: string | null
  }
  repository: GithubWebhookRepository
}

export interface GithubCheckRunWebhookPayload {
  action: string
  check_run: {
    id: number
    name: string
    status: string
    conclusion: string | null
    started_at: string | null
    completed_at: string | null
    head_sha: string
    app?: { slug: string } | null
    html_url?: string | null
    output?: { title?: string | null; summary?: string | null } | null
    pull_requests?: { number: number }[]
    check_suite?: { head_branch?: string | null }
  }
  repository: GithubWebhookRepository
}

export interface GithubStatusWebhookPayload {
  id: number
  sha: string
  context: string
  state: string
  created_at: string | null
  updated_at: string | null
  target_url?: string | null
  description?: string | null
  branches?: { name: string }[]
  repository: GithubWebhookRepository
}

export interface GithubPushWebhookPayload {
  ref: string
  repository: GithubWebhookRepository
}

export interface GithubWebhookUser {
  login: string
}

export interface GithubWebhookComment {
  id: number
  body: string
  html_url: string
  user: GithubWebhookUser | null
}

export interface GithubWebhookCommentChanges {
  body?: { from: string }
}

export interface GithubIssueCommentWebhookPayload {
  action: string
  issue: {
    number: number
    html_url: string
    pull_request?: { html_url: string }
  }
  comment: GithubWebhookComment
  changes?: GithubWebhookCommentChanges
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
  comment: GithubWebhookComment
  changes?: GithubWebhookCommentChanges
  sender: GithubWebhookUser
  repository: GithubWebhookRepository
}

export interface GithubAppInstallationAccount {
  login: string
  type: string
}

export interface GithubAppInstallationRepository {
  full_name: string
}

/**
 * The `installation` event fires for created/deleted/suspend/unsuspend and carries the full repo
 * list when the installation covers all repos; `installation_repositories` carries only the delta.
 */
export interface GithubAppInstallationWebhookPayload {
  action: string
  installation: {
    id: number
    account: GithubAppInstallationAccount
    suspended_at: string | null
  }
  repositories?: GithubAppInstallationRepository[]
}

export interface GithubAppInstallationRepositoriesWebhookPayload {
  action: string
  installation: {
    id: number
    account: GithubAppInstallationAccount
    suspended_at: string | null
  }
  repositories_added?: GithubAppInstallationRepository[]
  repositories_removed?: GithubAppInstallationRepository[]
  repository_selection?: string
}
