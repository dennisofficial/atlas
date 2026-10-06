import {
  EQualityReviewStatus,
  EQualitySkipReason,
  JEV_QUALITY_MODEL,
  applyAssessments,
  interpretQualityResponse,
  type CallId,
  type DecisionPort,
  type QualityAssessment,
  type QualityFinding,
  type QualityScope,
} from '@dltech/atlas-core'

import { withQualityDeadline } from './deadline'
import { buildAssessmentCacheKey, type QualityAssessmentCache } from './evaluation-cache'
import { buildRecord, type NotifiableEntry, type ReviewItem } from './review-records'
import type { RequestPlan, RequestUnit } from './review-scopes'

export type ScopeJob = {
  path: string
  scope: QualityScope
  plan: RequestPlan
  evidencePath?: string | undefined
}

export type UnitResult =
  | { kind: 'assessed'; assessments: readonly QualityAssessment[]; resolvedModel: string }
  | {
      kind: 'failed'
      status: EQualityReviewStatus
      reason?: EQualitySkipReason | undefined
      detail: string
      resolvedModel?: string | undefined
    }

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const failed = (facts: {
  status: EQualityReviewStatus
  reason?: EQualitySkipReason | undefined
  detail: string
  resolvedModel?: string | undefined
}): UnitResult => ({ kind: 'failed', ...facts })

export async function executeUnit({
  decisions,
  cache,
  scope,
  unit,
  signal,
  deadlineMs,
}: {
  decisions: DecisionPort
  cache: QualityAssessmentCache
  scope: QualityScope
  unit: RequestUnit
  signal: AbortSignal
  deadlineMs: number
}): Promise<UnitResult> {
  const key = buildAssessmentCacheKey({
    scope,
    policies: unit.policies,
    request: unit.request,
    requestedModel: JEV_QUALITY_MODEL,
  })
  const cached = cache.get({ key })
  if (cached !== undefined) return { kind: 'assessed', assessments: cached, resolvedModel: JEV_QUALITY_MODEL }

  const raced = await withQualityDeadline({
    signal,
    deadlineMs,
    work: (inner) =>
      decisions.decide({
        state: unit.request.state,
        questions: unit.request.questions,
        signal: inner,
        model: JEV_QUALITY_MODEL,
      }),
  })
  if (raced.kind === 'deadline') {
    return failed({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.ReviewDeadline,
      detail: `review exceeded ${deadlineMs}ms`,
    })
  }
  if (raced.kind === 'aborted') {
    return failed({
      status: EQualityReviewStatus.Skipped,
      reason: EQualitySkipReason.TurnInterrupted,
      detail: 'the turn was interrupted before the review finished',
    })
  }
  if (raced.kind === 'failed') {
    return failed({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.DecisionUnavailable,
      detail: describeError(raced.error),
    })
  }

  const outcome = raced.value
  if (!outcome.ok) {
    return failed({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.DecisionUnavailable,
      detail: outcome.fault,
    })
  }
  if (outcome.model !== JEV_QUALITY_MODEL) {
    return failed({
      status: EQualityReviewStatus.Inconclusive,
      reason: EQualitySkipReason.UncalibratedModel,
      detail: `requested ${JEV_QUALITY_MODEL} but the decision resolved ${outcome.model ?? 'no model identity'}`,
      resolvedModel: outcome.model,
    })
  }

  try {
    const assessments = interpretQualityResponse({
      request: unit.request,
      scope,
      policies: unit.policies,
      answers: outcome.answers,
    })
    if (assessments.every((assessment) => assessment.status === EQualityReviewStatus.Completed)) {
      cache.set({ key, assessments })
    }
    return { kind: 'assessed', assessments, resolvedModel: outcome.model }
  } catch (error) {
    return failed({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.DecisionUnavailable,
      detail: `interpretation failed: ${describeError(error)}`,
    })
  }
}

function statusOf({ assessments }: { assessments: readonly QualityAssessment[] }): EQualityReviewStatus {
  if (assessments.some((assessment) => assessment.status === EQualityReviewStatus.Completed)) {
    return EQualityReviewStatus.Completed
  }
  return assessments[0]?.status ?? EQualityReviewStatus.Inconclusive
}

type Failure = Extract<UnitResult, { kind: 'failed' }>

const detailOf = ({ failures }: { failures: readonly Failure[] }): string | undefined =>
  failures.length === 0 ? undefined : failures.map((failure) => failure.detail).join('; ')

export async function reviewScopeJob({
  decisions,
  cache,
  job,
  signal,
  deadlineMs,
}: {
  decisions: DecisionPort
  cache: QualityAssessmentCache
  job: ScopeJob
  signal: AbortSignal
  deadlineMs: () => number
}): Promise<UnitResult[]> {
  const executed = await Promise.all(
    job.plan.units.map((unit) =>
      executeUnit({ decisions, cache, scope: job.scope, unit, signal, deadlineMs: deadlineMs() }),
    ),
  )
  const rejected = job.plan.rejected.map((entry): UnitResult => ({ kind: 'failed', ...entry }))
  return [...executed, ...rejected]
}

export function recordScope({
  callId,
  job,
  results,
  previous,
  durationMs,
}: {
  callId: CallId
  job: ScopeJob
  results: readonly UnitResult[]
  previous: readonly QualityFinding[]
  durationMs: number
}): { item: ReviewItem; findings: readonly QualityFinding[] } {
  const { scope, path, evidencePath } = job
  const base = {
    callId,
    workspaceNamespace: scope.workspaceNamespace,
    path,
    scope,
    durationMs,
    requestedModel: JEV_QUALITY_MODEL,
    evidencePath,
  }
  const failures = results.filter((result): result is Failure => result.kind === 'failed')
  const assessed = results.flatMap((result) => (result.kind === 'assessed' ? [result] : []))

  if (assessed.length === 0) {
    const first = failures[0]
    const record = buildRecord({
      ...base,
      status: first?.status ?? EQualityReviewStatus.Inconclusive,
      reason: first?.reason,
      detail: detailOf({ failures }),
      resolvedModel: first?.resolvedModel,
      findings: previous,
    })
    return { item: { record, notifiable: [] }, findings: previous }
  }

  const assessments = assessed.flatMap((result) => result.assessments)
  const step = applyAssessments({ previous, assessments, afterHash: scope.afterHash, scopeDeleted: false })
  const policies = job.plan.units.flatMap((unit) => unit.policies)
  const notifiable = step.notifiable.flatMap((finding): NotifiableEntry[] => {
    const assessment = assessments.find((candidate) => candidate.policyId === finding.policyId)
    const policy = policies.find((candidate) => candidate.id === finding.policyId)
    return assessment === undefined || policy === undefined ? [] : [{ finding, assessment, scope, policy }]
  })
  const firstFailure = failures[0]
  const record = buildRecord({
    ...base,
    status: statusOf({ assessments }),
    reason: firstFailure?.reason,
    detail: detailOf({ failures }),
    assessments,
    findings: step.findings,
    resolvedModel: assessed[0]?.resolvedModel,
  })
  return { item: { record, notifiable }, findings: step.findings }
}
