import {
  EQualityReviewStatus,
  EQualitySkipReason,
  type CallId,
  type QualityFinding,
  type QualityScope,
} from '@dltech/atlas-core'

import { applyAssessments } from './ledger'

import { buildRecord, type ReviewItem } from './review-records'

type CoverageBase = { callId: CallId; workspaceNamespace: string; durationMs: number }

export function skipItem({
  callId,
  workspaceNamespace,
  durationMs,
  path,
  reason,
  detail,
  scope,
  previous = [],
}: CoverageBase & {
  path: string
  reason: EQualitySkipReason
  detail?: string | undefined
  scope?: QualityScope | undefined
  previous?: readonly QualityFinding[]
}): ReviewItem {
  const record = buildRecord({
    callId,
    workspaceNamespace,
    path,
    scope,
    status: EQualityReviewStatus.Skipped,
    reason,
    detail,
    findings: previous,
    durationMs,
  })
  return { record, notifiable: [] }
}

export function retirementItem({
  scope,
  path,
  previous,
  ...base
}: CoverageBase & {
  scope: QualityScope
  path: string
  previous: readonly QualityFinding[]
}): ReviewItem {
  const step = applyAssessments({ previous, assessments: [], afterHash: null, scopeDeleted: true })
  const record = buildRecord({
    ...base,
    path,
    scope,
    status: EQualityReviewStatus.Completed,
    detail: 'scope deleted',
    findings: step.findings,
  })
  return { record, notifiable: [] }
}
