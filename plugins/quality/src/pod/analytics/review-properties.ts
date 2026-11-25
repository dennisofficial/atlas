import {
  EQualityFindingState,
  EQualityReviewStatus,
  EQualitySkipReason,
  EQualityTransition,
  type CodeQualityReviewedBody,
  type QualityAssessment,
  type ThreadId,
  type RecordEvent,
} from '@dltech/atlas-core'
import type { PodAnalyticsRecord, PodAnalyticsValue } from '@dltech/atlas-plugin-sdk'

import type { QualityReviewMetrics } from '../../review/engine'
import { qualityRecordsOf, notifyIndexOf, stepsAfter, threadEventsOf, turnsAfter } from './timeline'

export const QUALITY_REVIEW_COMPLETED = 'quality review completed'
export const QUALITY_FINDING_RESOLVED = 'quality finding resolved'
export const QUALITY_FINDING_IGNORED = 'quality finding ignored'

export type QualityReviewEventStatus = 'completed' | 'skipped' | 'deadline' | 'operational_error'

export type QualityPolicyOutcome = 'new_finding' | 'tracked_debt' | 'resolved' | 'clean'

export type QualityReviewEventProperties = Readonly<Record<string, PodAnalyticsValue>>

const OUTCOME_PRECEDENCE: readonly QualityPolicyOutcome[] = [
  'new_finding',
  'tracked_debt',
  'resolved',
  'clean',
]

const stronger = (left: QualityPolicyOutcome, right: QualityPolicyOutcome): QualityPolicyOutcome =>
  OUTCOME_PRECEDENCE.indexOf(left) <= OUTCOME_PRECEDENCE.indexOf(right) ? left : right

export const reviewStatusOf = (args: {
  records: readonly CodeQualityReviewedBody[]
}): QualityReviewEventStatus => {
  const { records } = args
  if (records.some((record) => record.reason === EQualitySkipReason.ReviewDeadline))
    return 'deadline'
  if (records.some((record) => record.status === EQualityReviewStatus.OperationalError))
    return 'operational_error'
  if (
    records.length > 0 &&
    records.every((record) => record.status === EQualityReviewStatus.Skipped)
  )
    return 'skipped'
  return 'completed'
}

const skipReasonOf = (records: readonly CodeQualityReviewedBody[]): EQualitySkipReason | null =>
  records.find((record) => record.reason !== undefined)?.reason ?? null

const wasNotified = (args: {
  record: CodeQualityReviewedBody
  assessment: QualityAssessment
}): boolean =>
  args.record.findings.some(
    (finding) =>
      finding.policyId === args.assessment.policyId &&
      finding.scopeId === args.assessment.scopeId &&
      finding.notified,
  )

const outcomeOf = (args: {
  record: CodeQualityReviewedBody
  assessment: QualityAssessment
}): QualityPolicyOutcome => {
  const { assessment } = args
  if (assessment.transition === EQualityTransition.Introduce && wasNotified(args))
    return 'new_finding'
  if (assessment.transition === EQualityTransition.TrackDebt) return 'tracked_debt'
  if (assessment.transition === EQualityTransition.Resolve) return 'resolved'
  return 'clean'
}

export const policiesOf = (args: {
  records: readonly CodeQualityReviewedBody[]
}): readonly PodAnalyticsRecord[] => {
  const byPolicy = new Map<
    string,
    { outcome: QualityPolicyOutcome; maxConfidence: number | null }
  >()
  for (const record of args.records) {
    for (const assessment of record.assessments) {
      const outcome = outcomeOf({ record, assessment })
      const held = byPolicy.get(assessment.policyId) ?? { outcome, maxConfidence: null }
      const confidence = assessment.currentConcernProbability
      byPolicy.set(assessment.policyId, {
        outcome: stronger(held.outcome, outcome),
        maxConfidence:
          confidence !== null && (held.maxConfidence === null || confidence > held.maxConfidence)
            ? confidence
            : held.maxConfidence,
      })
    }
  }
  return [...byPolicy.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([policyId, held]) => ({
      policy_id: policyId,
      outcome: held.outcome,
      max_confidence: held.maxConfidence,
    }))
}

export const reviewCompletedProperties = (args: {
  records: readonly CodeQualityReviewedBody[]
  metrics: QualityReviewMetrics
  files: number
  notified: boolean
  classifier: { model: string; provider: string }
  events: readonly RecordEvent[]
}): QualityReviewEventProperties => {
  const policies = policiesOf({ records: args.records })
  return {
    status: reviewStatusOf({ records: args.records }),
    skip_reason: skipReasonOf(args.records),
    policy_ids: policies.map((policy) => String(policy.policy_id)),
    policies,
    files: args.files,
    notified: args.notified,
    classifier_model: args.classifier.model,
    classifier_provider: args.classifier.provider,
    scope_build_ms: args.metrics.timings.scopeBuildMs,
    classifier_ms: args.metrics.timings.classifierMs,
    total_ms: args.metrics.timings.totalMs,
    input_tokens: args.metrics.inputTokens,
    language: args.metrics.language,
    first_review_in_session: qualityRecordsOf({ events: args.events }).length === 0,
  }
}

export const resolvedFindingProperties = (args: {
  records: readonly CodeQualityReviewedBody[]
  events: readonly RecordEvent[]
  threadId: ThreadId
}): readonly QualityReviewEventProperties[] => {
  const thread = threadEventsOf({ events: args.events, threadId: args.threadId })
  const resolvedBefore = new Set(
    qualityRecordsOf({ events: thread }).flatMap(({ record }) =>
      record.findings
        .filter((finding) => finding.state === EQualityFindingState.Resolved)
        .map((finding) => finding.id),
    ),
  )
  const properties: QualityReviewEventProperties[] = []
  for (const record of args.records) {
    for (const finding of record.findings) {
      if (finding.state !== EQualityFindingState.Resolved) continue
      if (!finding.notified || resolvedBefore.has(finding.id)) continue
      const assessment = record.assessments.find(
        (candidate) =>
          candidate.policyId === finding.policyId && candidate.scopeId === finding.scopeId,
      )
      if (assessment?.transition !== EQualityTransition.Resolve) continue
      const index = notifyIndexOf({ events: thread, findingId: finding.id })
      if (index === null) continue
      properties.push({
        policy_id: finding.policyId,
        steps_after_nudge: stepsAfter({ events: thread, index }),
        turns_after_nudge: turnsAfter({ events: thread, index }),
      })
    }
  }
  return properties
}
