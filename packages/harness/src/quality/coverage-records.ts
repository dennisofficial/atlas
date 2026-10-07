import {
  EQualityReviewStatus,
  EQualitySkipReason,
  applyAssessments,
  type CallId,
  type QualityFinding,
  type QualityScope,
} from '@dltech/atlas-core'

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
  evidencePath,
}: CoverageBase & {
  path: string
  reason: EQualitySkipReason
  detail?: string | undefined
  scope?: QualityScope | undefined
  previous?: readonly QualityFinding[]
  evidencePath?: string | undefined
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
    evidencePath,
  })
  return { record, notifiable: [] }
}

export function recordingFaultItem({
  fault,
  path,
  ...base
}: CoverageBase & { path: string; fault: string }): ReviewItem {
  const record = buildRecord({
    ...base,
    path,
    status: EQualityReviewStatus.OperationalError,
    detail: `example recording failed: ${fault}`,
  })
  return { record, notifiable: [] }
}

export function retirementItem({
  scope,
  path,
  previous,
  ...base
}: CoverageBase & { scope: QualityScope; path: string; previous: readonly QualityFinding[] }): ReviewItem {
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
