import React from 'react'

import {
  EQualityFindingState,
  EQualityReviewStatus,
  EQualitySkipReason,
  EQualityTransition,
  singleResponsibilityPolicy,
  type CodeQualityReviewedBody,
} from '@dltech/atlas-core'

import { glyph, theme } from '../../theme'

const POLICY_TITLES: Readonly<Record<string, string>> = {
  [singleResponsibilityPolicy.id]: singleResponsibilityPolicy.title,
}

const policyTitle = (id: string): string => POLICY_TITLES[id] ?? id

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

const operationalFailure = (review: CodeQualityReviewedBody): string | undefined => {
  if (review.reason === EQualitySkipReason.ReviewDeadline) return 'timed out'
  if (review.reason === EQualitySkipReason.DecisionUnavailable) return 'decision unavailable'
  if (review.reason === EQualitySkipReason.UncalibratedModel) return 'uncalibrated model'
  if (review.status === EQualityReviewStatus.OperationalError) return undefined
  return undefined
}

export function qualityNoticeOf(reviews: readonly CodeQualityReviewedBody[] | undefined): {
  findings: number
  policyIds: readonly string[]
  failure: string | undefined
} | null {
  if (reviews === undefined || reviews.length === 0) return null

  const findings = reviews.reduce((total, review) => total + newlyNotified(review), 0)
  const failed = reviews.find((review) => operationalFailure(review) !== undefined)
  if (findings === 0 && failed === undefined) return null

  return {
    findings,
    policyIds: [...new Set(
      reviews.flatMap((review) =>
        review.findings
          .filter((finding) => finding.state === EQualityFindingState.Active && finding.notified)
          .map((finding) => finding.policyId),
      ),
    )],
    failure: failed === undefined ? undefined : operationalFailure(failed),
  }
}

export type QualityNotice = NonNullable<ReturnType<typeof qualityNoticeOf>>

export function qualityNoticeText(notice: QualityNotice): { text: string; fg: string } {
  if (notice.findings > 0) {
    const label =
      notice.findings === 1 && notice.policyIds.length === 1
        ? policyTitle(notice.policyIds[0] ?? '')
        : `${notice.findings} quality findings`
    return { text: ` ${glyph.warning} ${label}`, fg: theme.warn }
  }
  return { text: ` ${glyph.failed} review ${notice.failure ?? 'failed'}`, fg: theme.error }
}

export function QualityIndicator(props: { notice: QualityNotice }): React.ReactNode {
  const { text, fg } = qualityNoticeText(props.notice)
  return <span fg={fg}>{text}</span>
}
