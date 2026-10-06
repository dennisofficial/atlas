import { EQualityFindingState, EQualityReviewStatus, type EQualitySkipReason } from './policy'
import type { CodeQualityReviewedBody } from './schema'

export const QUALITY_HEALTH_LABEL = 'last recorded review'

export enum EQualityHealthStatus {
  NoReview = 'no_review',
  CompletedNoFinding = 'completed_no_finding',
  Finding = 'finding',
  Skipped = 'skipped',
  Inconclusive = 'inconclusive',
  OperationalError = 'operational_error',
}

export type QualityHealthRecord = CodeQualityReviewedBody & { at: string }

export type QualityHealth = {
  label: typeof QUALITY_HEALTH_LABEL
  status: EQualityHealthStatus
  path: string | null
  scope: { id: string; name: string; kind: string } | null
  policyIds: readonly string[]
  recordedAt: string | null
  reason?: EQualitySkipReason | undefined
  detail?: string | undefined
}

const NO_REVIEW: QualityHealth = {
  label: QUALITY_HEALTH_LABEL,
  status: EQualityHealthStatus.NoReview,
  path: null,
  scope: null,
  policyIds: [],
  recordedAt: null,
}

function statusOf(record: QualityHealthRecord): EQualityHealthStatus {
  if (record.status === EQualityReviewStatus.Skipped) return EQualityHealthStatus.Skipped
  if (record.status === EQualityReviewStatus.Inconclusive) return EQualityHealthStatus.Inconclusive
  if (record.status === EQualityReviewStatus.OperationalError) return EQualityHealthStatus.OperationalError
  const hasFinding = record.findings.some((finding) => finding.state === EQualityFindingState.Active)
  return hasFinding ? EQualityHealthStatus.Finding : EQualityHealthStatus.CompletedNoFinding
}

export function projectQualityHealth({ records }: { records: readonly QualityHealthRecord[] }): QualityHealth {
  const latest = records.at(-1)
  if (latest === undefined) return NO_REVIEW

  return {
    label: QUALITY_HEALTH_LABEL,
    status: statusOf(latest),
    path: latest.path,
    scope: latest.scope === undefined ? null : { id: latest.scope.id, name: latest.scope.name, kind: latest.scope.kind },
    policyIds: [...new Set(latest.assessments.map((assessment) => assessment.policyId))],
    recordedAt: latest.at,
    reason: latest.reason,
    detail: latest.detail,
  }
}
