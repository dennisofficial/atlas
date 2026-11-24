import type {
  CallId,
  CapturedFileChange,
  CodeQualityReviewedBody,
  EQualitySkipReason,
  Event,
  QualityCoverageDiagnostic,
  QualityFinding,
  QualityPolicy,
  QualityScope,
  ToolCall,
} from '@dltech/atlas-core'

import type { ReviewItem } from './review-records'
import type { ScopeJob } from './scope-review'

export type ReviewArgs = {
  call: ToolCall
  changes: readonly CapturedFileChange[]
  captureFaults: readonly QualityCoverageDiagnostic[]
  events: readonly Event[]
  projectDirectory: string
  signal: AbortSignal
  deadlineAt?: number | undefined
}

export type ReviewContext = ReviewArgs & {
  namespace: string
  started: number
  records: readonly CodeQualityReviewedBody[]
  ledger: ReadonlyMap<string, readonly QualityFinding[]>
  policies: readonly QualityPolicy[]
}

export type CoverageBase = {
  callId: CallId
  workspaceNamespace: string
  durationMs: number
}

export type SkipArgs = {
  ctx: ReviewContext
  path: string
  reason: EQualitySkipReason
  detail?: string | undefined
  scope?: QualityScope | undefined
}

export type ChangeReview = { items: ReviewItem[]; jobs: ScopeJob[] }
