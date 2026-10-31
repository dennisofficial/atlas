import type { EPrEventKind, EPrReviewState, EPrVerdict } from './body'

export type PrEventBody =
  | {
      type: 'pull-request-linked'
      number: number
      url: string
      repo: string
      branch: string
      worktreePath?: string | undefined
    }
  | {
      type: 'pr-event'
      repo: string
      prNumber: number
      kind: EPrEventKind
      url: string
      authorLogin?: string | undefined
      body?: string | undefined
      verdict?: EPrVerdict | undefined
      headSha?: string | undefined
      edited?: boolean | undefined
      settled?: boolean | undefined
      mergeable?: boolean | undefined
      state?: string | undefined
      reviewState?: EPrReviewState | undefined
    }
