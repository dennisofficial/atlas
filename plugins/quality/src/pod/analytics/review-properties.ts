import {
  EQualityFindingState,
  EQualityReviewStatus,
  EQualitySkipReason,
  EQualityTransition,
  type CodeQualityReviewedBody,
  type RecordEvent,
  type ThreadId,
} from '@dltech/atlas-core'
import type { PodAnalyticsRecord, PodAnalyticsValue } from '@dltech/atlas-plugin-sdk'

import type { QualityReviewMetrics } from '../../review/engine'
import { extensionOf } from './paths'
import { wasNotified, type QualityNotified } from './review-links'
import { notifyIndexOf, qualityRecordsOf, stepsAfter, threadEventsOf, turnsAfter } from './timeline'
import {
  nudgeKindOf,
  strongerVerdictOf,
  verdictOf,
  type EQualityVerdict,
  type ENudgeKind,
} from './verdict'

export const QUALITY_REVIEW_COMPLETED = 'quality review completed'
export const QUALITY_FINDING_RESOLVED = 'quality finding resolved'
export const QUALITY_FINDING_CLOSED = 'quality finding closed'

export type QualityReviewEventStatus = 'completed' | 'skipped' | 'deadline' | 'operational_error'

export type QualityReviewEventProperties = Readonly<Record<string, PodAnalyticsValue>>

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

const skipReasonsOf = (records: readonly CodeQualityReviewedBody[]): readonly string[] =>
  [
    ...new Set(records.flatMap((record) => (record.reason === undefined ? [] : [record.reason]))),
  ].sort()

const extensionsOf = (records: readonly CodeQualityReviewedBody[]): readonly string[] =>
  [
    ...new Set(
      records.map((record) => extensionOf({ path: record.path })).filter((held) => held !== ''),
    ),
  ].sort()

const scopeIdsOf = (args: {
  records: readonly CodeQualityReviewedBody[]
  selected: boolean
}): readonly string[] => [
  ...new Set(
    args.records.flatMap((record) => {
      if (record.scope === undefined) return []
      if (args.selected && record.requestedModel === undefined) return []
      return [record.scope.id]
    }),
  ),
]

export const policiesOf = (args: {
  records: readonly CodeQualityReviewedBody[]
  notified: readonly QualityNotified[]
}): readonly PodAnalyticsRecord[] => {
  const byPolicy = new Map<string, { verdict: EQualityVerdict; maxConcern: number | null }>()
  for (const record of args.records) {
    for (const assessment of record.assessments) {
      const verdict = verdictOf({
        assessment,
        notified: wasNotified({
          notified: args.notified,
          policyId: assessment.policyId,
          scopeId: assessment.scopeId,
        }),
      })
      const held = byPolicy.get(assessment.policyId) ?? { verdict, maxConcern: null }
      const concern = assessment.currentConcernProbability
      byPolicy.set(assessment.policyId, {
        verdict: strongerVerdictOf({ left: held.verdict, right: verdict }),
        maxConcern:
          concern !== null && (held.maxConcern === null || concern > held.maxConcern)
            ? concern
            : held.maxConcern,
      })
    }
  }
  return [...byPolicy.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([policyId, held]) => ({
      policy_id: policyId,
      verdict: held.verdict,
      max_concern: held.maxConcern,
    }))
}

const nudgeKindsOf = (args: {
  records: readonly CodeQualityReviewedBody[]
  notified: readonly QualityNotified[]
}): readonly ENudgeKind[] => {
  const kinds = new Set<ENudgeKind>()
  for (const record of args.records) {
    for (const assessment of record.assessments) {
      const notified = wasNotified({
        notified: args.notified,
        policyId: assessment.policyId,
        scopeId: assessment.scopeId,
      })
      const kind = notified ? nudgeKindOf({ transition: assessment.transition }) : null
      if (kind !== null) kinds.add(kind)
    }
  }
  return [...kinds].sort()
}

export const reviewCompletedProperties = (args: {
  reviewId: string
  records: readonly CodeQualityReviewedBody[]
  metrics: QualityReviewMetrics
  files: number
  notified: boolean
  nudged: readonly QualityNotified[]
  tool: string
  classifier: { model: string; provider: string }
  events: readonly RecordEvent[]
}): QualityReviewEventProperties => {
  const policies = policiesOf({ records: args.records, notified: args.nudged })
  const skipped = skipReasonsOf(args.records)
  const kinds = nudgeKindsOf({ records: args.records, notified: args.nudged })
  return {
    review_id: args.reviewId,
    status: reviewStatusOf({ records: args.records }),
    skip_reason: skipReasonOf(args.records),
    skip_reasons: skipped,
    policy_ids: policies.map((policy) => String(policy.policy_id)),
    policies,
    files: args.files,
    notified: args.notified,
    ...(kinds.length === 0 ? {} : { nudge_kind: kinds }),
    tool: args.tool,
    scopes_total: scopeIdsOf({ records: args.records, selected: false }).length,
    scopes_selected: scopeIdsOf({ records: args.records, selected: true }).length,
    extensions: extensionsOf(args.records),
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
  reviewId: string
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
        review_id: args.reviewId,
        policy_id: finding.policyId,
        steps_after_nudge: stepsAfter({ events: thread, index }),
        turns_after_nudge: turnsAfter({ events: thread, index }),
      })
    }
  }
  return properties
}
