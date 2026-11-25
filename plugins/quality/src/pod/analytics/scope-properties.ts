import type { CodeQualityReviewedBody, DecisionAnswer, QualityAssessment } from '@dltech/atlas-core'

import {
  CONCERN_INTRODUCE_THRESHOLD,
  FOCUS_CONFIDENCE_THRESHOLD,
  IMPACT_CONFIDENCE_THRESHOLD,
} from '../../policies/single-responsibility/interpret'
import {
  FOCUS_NONE,
  FOCUS_UNCERTAIN,
  QUESTION_FOCUS,
  QUESTION_IMPACT,
} from '../../policies/single-responsibility/keys'
import type { QualityScopeFacts } from '../../review/engine'
import { extensionOf } from './paths'
import { wasNotified, type QualityNotified } from './review-links'
import type { QualityReviewEventProperties } from './review-properties'
import { nearMissOf, verdictOf } from './verdict'

export const QUALITY_SCOPE_ASSESSED = 'quality scope assessed'

const chosenProbabilityOf = ({ answer }: { answer: DecisionAnswer | undefined }): number | null => {
  if (answer === undefined) return null
  const chosen = answer.choice === undefined ? undefined : answer.probabilities?.[answer.choice]
  return chosen ?? answer.confidence ?? null
}

const focusConfidentOf = ({ assessment }: { assessment: QualityAssessment }): boolean => {
  const answer = assessment.rawAnswers[QUESTION_FOCUS]
  if (answer?.choice === undefined) return false
  if (answer.choice === FOCUS_NONE || answer.choice === FOCUS_UNCERTAIN) return false
  return (chosenProbabilityOf({ answer }) ?? 0) >= FOCUS_CONFIDENCE_THRESHOLD
}

export const scopeAssessedProperties = (args: {
  reviewId: string
  record: CodeQualityReviewedBody
  assessment: QualityAssessment
  facts: QualityScopeFacts
  notified: readonly QualityNotified[]
}): QualityReviewEventProperties => {
  const verdict = verdictOf({
    assessment: args.assessment,
    notified: wasNotified({
      notified: args.notified,
      policyId: args.assessment.policyId,
      scopeId: args.assessment.scopeId,
    }),
  })
  const concern = args.assessment.currentConcernProbability
  return {
    review_id: args.reviewId,
    scope_id: args.assessment.scopeId,
    policy_id: args.assessment.policyId,
    policy_version: args.assessment.policyVersion,
    scope_kind: args.record.scope?.kind ?? null,
    change_kind: args.facts.changeKind,
    language: args.record.scope?.language ?? null,
    extension: extensionOf({ path: args.record.path }),
    scope_lines: args.facts.scopeLines,
    scope_bytes: args.facts.scopeBytes,
    diff_lines: args.facts.diffLines,
    request_bytes: args.facts.requestBytes,
    concern_score: concern,
    impact: args.assessment.impact,
    impact_confidence: chosenProbabilityOf({
      answer: args.assessment.rawAnswers[QUESTION_IMPACT],
    }),
    focus_confident: focusConfidentOf({ assessment: args.assessment }),
    transition: args.assessment.transition,
    verdict,
    near_miss: nearMissOf({ verdict, concern }),
    concern_threshold: CONCERN_INTRODUCE_THRESHOLD,
    impact_threshold: IMPACT_CONFIDENCE_THRESHOLD,
    deadline_missed: args.facts.deadlineMissed,
    classifier_ms: args.facts.classifierMs,
  }
}
