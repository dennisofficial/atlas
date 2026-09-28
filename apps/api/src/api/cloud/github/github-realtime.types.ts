export enum ERepoHookStatus {
  Active = 'active',
  Orphaned = 'orphaned',
  Deleting = 'deleting',
}

export enum EPrRealtimeEvent {
  PrState = 'pr-state',
  Heartbeat = 'heartbeat',
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

export interface GithubSubscriptionDto {
  id: string
  repoFullName: string
  prNumber: number
  pollBacked: boolean
  expiresAt: string
  state: GithubPrStateDto | null
}
