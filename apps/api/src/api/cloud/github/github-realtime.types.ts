export enum ERepoHookStatus {
  Active = 'active',
  Orphaned = 'orphaned',
  Deleting = 'deleting',
}

export enum EPrEventKind {
  Comment = 'comment',
  Review = 'review',
  ReviewComment = 'review-comment',
  Verdict = 'verdict',
  Mergeability = 'mergeability',
  State = 'state',
}

export type GithubPrCheckAnnotation = {
  path?: string
  line?: number
  message: string
  title?: string
}

export type GithubPrFailedCheck = {
  name: string
  app?: string
  url?: string
  checkRunId?: string
  conclusion?: string
  title?: string
  summary?: string
  annotations?: GithubPrCheckAnnotation[]
}

export type GithubPrEventPayload = {
  url: string
  authorLogin?: string
  body?: string
  reviewState?: string
  verdict?: 'green' | 'failed'
  mergeable?: boolean
  state?: 'merged' | 'closed'
  headSha?: string
  settled?: boolean
  failedChecks?: GithubPrFailedCheck[]
  commentId?: string
  edited?: boolean
  path?: string
  line?: number
  startLine?: number
  side?: string
  diffHunk?: string
  inReplyTo?: string
}

export interface GithubPrEventDto {
  id: string
  repoFullName: string
  prNumber: number
  kind: EPrEventKind
  payload: GithubPrEventPayload
  createdAt: string
}

export interface GithubPrStateDto {
  repoFullName: string
  prNumber: number
  title: string
  url: string
  state: string
  headBranch: string
  headSha: string
  checksRunning: number
  checksPassed: number
  checksFailed: number
  checksIgnored: number
  mergeable: boolean | null
  version: number
  updatedAt: string
}

export type GithubPrStateFields = Omit<
  GithubPrStateDto,
  'repoFullName' | 'prNumber' | 'updatedAt' | 'version'
>

export type GithubPrStateRecord = GithubPrStateFields & {
  updatedAt: Date
  headRepoFullName: string | null
}

export interface GithubBranchRouting {
  headBranch: string
  headRepoMatchesBase: boolean
}

export interface GithubSubscribeArgs {
  userId: string
  repoFullName: string
  prNumber?: number
  branch?: string
  threadId?: string
}

export interface GithubSubscriptionDto {
  id: string
  repoFullName: string
  prNumber: number | null
  branch: string
  pollBacked: boolean
  expiresAt: string
  state: GithubPrStateDto | null
  recommendAppInstall?: { installUrl: string; repoFullName: string }
}
