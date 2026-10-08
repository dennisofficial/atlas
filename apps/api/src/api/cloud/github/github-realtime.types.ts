export enum ERepoHookStatus {
  Active = 'active',
  Orphaned = 'orphaned',
  Deleting = 'deleting',
}

export enum EPrRealtimeEvent {
  PrState = 'pr-state',
  PrEvent = 'pr-event',
  Heartbeat = 'heartbeat',
}

export enum EPrEventKind {
  Comment = 'comment',
  Review = 'review',
  ReviewComment = 'review-comment',
  Verdict = 'verdict',
  Mergeability = 'mergeability',
  State = 'state',
}

export type GithubPrEventPayload = {
  url: string
  authorLogin: string
  body?: string
  reviewState?: string
  verdict?: 'green' | 'failed'
  mergeable?: boolean
  state?: 'merged' | 'closed'
  headSha: string
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
  mergeable: boolean | null
  updatedAt: string
}

export type GithubPrStateFields = Omit<GithubPrStateDto, 'repoFullName' | 'prNumber' | 'updatedAt'>

export type GithubPrStateRecord = GithubPrStateFields & {
  updatedAt: Date
  headRepoFullName: string | null
}

export interface GithubBranchRouting {
  headBranch: string
  headRepoMatchesBase: boolean
}

export interface GithubSubscriptionDto {
  id: string
  repoFullName: string
  prNumber: number | null
  branch: string
  pollBacked: boolean
  expiresAt: string
  state: GithubPrStateDto | null
}
