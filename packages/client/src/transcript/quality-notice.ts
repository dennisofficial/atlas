import {
  EQualityFindingState,
  EQualitySkipReason,
  EQualityTransition,
  singleResponsibilityPolicy,
  type CodeQualityReviewedBody,
} from '@dltech/atlas-core'

export enum EQualityNoticeTone {
  Warning = 'warning',
  Failure = 'failure',
}

export type QualityNotice = {
  findings: number
  policyIds: readonly string[]
  failure: string | undefined
}

export type QualityNoticeLine = { tone: EQualityNoticeTone; label: string }

const POLICY_TITLES: Readonly<Record<string, string>> = {
  [singleResponsibilityPolicy.id]: singleResponsibilityPolicy.title,
}

const FAILURE_LABELS: Readonly<Partial<Record<EQualitySkipReason, string>>> = {
  [EQualitySkipReason.ReviewDeadline]: 'timed out',
  [EQualitySkipReason.DecisionUnavailable]: 'decision unavailable',
  [EQualitySkipReason.UncalibratedModel]: 'uncalibrated model',
}

const policyTitle = (id: string): string => POLICY_TITLES[id] ?? id

const failureLabel = (review: CodeQualityReviewedBody): string | undefined =>
  review.reason === undefined ? undefined : FAILURE_LABELS[review.reason]

const newlyNotified = (review: CodeQualityReviewedBody): number =>
  review.findings.filter(
    (finding) =>
      finding.state === EQualityFindingState.Active &&
      finding.notified &&
      review.assessments.some(
        (assessment) =>
          assessment.policyId === finding.policyId &&
          assessment.scopeId === finding.scopeId &&
          assessment.transition === EQualityTransition.Introduce,
      ),
  ).length

export function qualityNoticeOf(
  reviews: readonly CodeQualityReviewedBody[] | undefined,
): QualityNotice | null {
  if (reviews === undefined || reviews.length === 0) return null

  const findings = reviews.reduce((total, review) => total + newlyNotified(review), 0)
  const failed = reviews.find((review) => failureLabel(review) !== undefined)
  if (findings === 0 && failed === undefined) return null

  return {
    findings,
    policyIds: [
      ...new Set(
        reviews.flatMap((review) =>
          review.findings
            .filter((finding) => finding.state === EQualityFindingState.Active && finding.notified)
            .map((finding) => finding.policyId),
        ),
      ),
    ],
    failure: failed === undefined ? undefined : failureLabel(failed),
  }
}

export function qualityNoticeLine(notice: QualityNotice): QualityNoticeLine {
  if (notice.findings > 0) {
    const label =
      notice.findings === 1 && notice.policyIds.length === 1
        ? policyTitle(notice.policyIds[0] ?? '')
        : `${notice.findings} quality findings`
    return { tone: EQualityNoticeTone.Warning, label }
  }
  return { tone: EQualityNoticeTone.Failure, label: `review ${notice.failure ?? 'failed'}` }
}
