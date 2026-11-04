import type { PrFailedCheck } from '../github/failed-check'
import type { EPrEventKind, EPrReviewState, EPrVerdict } from './body'
import type { NoticeStamp } from './notice-stage'

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
      eventId?: string | undefined
      authorLogin?: string | undefined
      body?: string | undefined
      verdict?: EPrVerdict | undefined
      headSha?: string | undefined
      edited?: boolean | undefined
      settled?: boolean | undefined
      failedChecks?: readonly PrFailedCheck[] | undefined
      mergeable?: boolean | undefined
      state?: string | undefined
      reviewState?: EPrReviewState | undefined
      path?: string | undefined
      line?: number | undefined
      startLine?: number | undefined
      side?: string | undefined
      diffHunk?: string | undefined
      inReplyTo?: string | undefined
      notice?: NoticeStamp | undefined
    }
