import {
  EQualityReviewStatus,
  EQualityTransition,
  type QualityAssessment,
} from '@dltech/atlas-core'

export enum EQualityVerdict {
  Nudged = 'nudged',
  DebtNudged = 'debt_nudged',
  Repeat = 'repeat',
  TrackedDebt = 'tracked_debt',
  NearMiss = 'near_miss',
  Clean = 'clean',
  Inconclusive = 'inconclusive',
}

export enum ENudgeKind {
  New = 'new',
  Debt = 'debt',
}

export const NEAR_MISS_CONCERN = 0.5

const STRENGTH: readonly EQualityVerdict[] = [
  EQualityVerdict.Nudged,
  EQualityVerdict.DebtNudged,
  EQualityVerdict.Repeat,
  EQualityVerdict.TrackedDebt,
  EQualityVerdict.NearMiss,
  EQualityVerdict.Inconclusive,
  EQualityVerdict.Clean,
]

export const nudgeKindOf = (args: { transition: EQualityTransition }): ENudgeKind | null => {
  if (args.transition === EQualityTransition.Introduce) return ENudgeKind.New
  if (args.transition === EQualityTransition.TrackDebt) return ENudgeKind.Debt
  return null
}

export const verdictOf = (args: {
  assessment: QualityAssessment
  notified: boolean
}): EQualityVerdict => {
  const { assessment } = args
  if (assessment.status !== EQualityReviewStatus.Completed) return EQualityVerdict.Inconclusive
  if (assessment.transition === EQualityTransition.Introduce)
    return args.notified ? EQualityVerdict.Nudged : EQualityVerdict.Repeat
  if (assessment.transition === EQualityTransition.TrackDebt)
    return args.notified ? EQualityVerdict.DebtNudged : EQualityVerdict.TrackedDebt
  if (assessment.transition === EQualityTransition.Resolve) return EQualityVerdict.Clean
  return (assessment.currentConcernProbability ?? 0) >= NEAR_MISS_CONCERN
    ? EQualityVerdict.NearMiss
    : EQualityVerdict.Clean
}

export const strongerVerdictOf = (args: {
  left: EQualityVerdict
  right: EQualityVerdict
}): EQualityVerdict =>
  STRENGTH.indexOf(args.left) <= STRENGTH.indexOf(args.right) ? args.left : args.right

export const nearMissOf = (args: { verdict: EQualityVerdict; concern: number | null }): boolean =>
  args.verdict !== EQualityVerdict.Nudged &&
  args.verdict !== EQualityVerdict.DebtNudged &&
  (args.verdict === EQualityVerdict.TrackedDebt || (args.concern ?? 0) >= NEAR_MISS_CONCERN)
