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
  head: { ref: string; sha: string }
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

export interface GithubPushWebhookPayload {
  ref: string
  repository: GithubWebhookRepository
}
