import {
  EQualityReviewStatus,
  EQualitySkipReason,
  applyAssessments,
  interpretQualityResponse,
  type CallId,
  type ClassifierPort,
  type ClassifierQuestion,
  type DecisionQuestion,
  type QualityAssessment,
  type QualityFinding,
  type QualityScope,
} from '@dltech/atlas-core'

import { deadlineErrorOf, settleUnderBudget, type QualityDeadlineError } from './deadline'
import { buildRecord, type NotifiableEntry, type ReviewItem } from './review-records'
import type { RequestPlan, RequestUnit } from './review-scopes'

export type ScopeJob = {
  path: string
  scope: QualityScope
  plan: RequestPlan
}

export type UnitResult =
  | {
      kind: 'assessed'
      assessments: readonly QualityAssessment[]
      resolvedModel: string
      inputTokens: number | null
    }
  | {
      kind: 'failed'
      status: EQualityReviewStatus
      reason?: EQualitySkipReason | undefined
      detail: string
      resolvedModel?: string | undefined
      inputTokens: number | null
    }

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const failed = (facts: {
  status: EQualityReviewStatus
  reason?: EQualitySkipReason | undefined
  detail: string
  resolvedModel?: string | undefined
  inputTokens?: number | null
}): UnitResult => ({ kind: 'failed', ...facts, inputTokens: facts.inputTokens ?? null })

const abortedFailure = ({ signal }: { signal: AbortSignal }): UnitResult | undefined => {
  if (!signal.aborted) return undefined
  const error = deadlineErrorOf(signal)
  return error === undefined
    ? failed({
        status: EQualityReviewStatus.Skipped,
        reason: EQualitySkipReason.TurnInterrupted,
        detail: 'the turn was interrupted before the review finished',
      })
    : deadlineFailure({ error })
}

export const deadlineFailure = ({ error }: { error: QualityDeadlineError }): UnitResult =>
  failed({
    status: EQualityReviewStatus.OperationalError,
    reason: EQualitySkipReason.ReviewDeadline,
    detail: error.message,
  })

export function classifierQuestionsOf({
  questions,
}: {
  questions: Record<string, DecisionQuestion>
}): Record<string, ClassifierQuestion> {
  const narrowed: Record<string, ClassifierQuestion> = {}
  for (const [name, question] of Object.entries(questions)) {
    if (question.type === 'score')
      throw new Error(
        `quality question "${name}" is a score question, which a classifier cannot answer`,
      )
    narrowed[name] = question
  }
  return narrowed
}

export async function executeUnit({
  classifier,
  requestedModel,
  scope,
  unit,
  signal,
}: {
  classifier: ClassifierPort
  requestedModel: string
  scope: QualityScope
  unit: RequestUnit
  signal: AbortSignal
}): Promise<UnitResult> {
  const aborted = abortedFailure({ signal })
  if (aborted !== undefined) return aborted

  const raced = await settleUnderBudget({
    signal,
    work: (inner) =>
      classifier.classify({
        state: unit.request.state,
        questions: classifierQuestionsOf({ questions: unit.request.questions }),
        signal: inner,
      }),
  })
  if (raced.kind === 'deadline') return deadlineFailure({ error: raced.error })
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
      detail: `${outcome.fault}: ${outcome.detail}`,
    })
  }
  if (outcome.model !== requestedModel) {
    return failed({
      status: EQualityReviewStatus.Inconclusive,
      reason: EQualitySkipReason.UncalibratedModel,
      detail: `requested ${requestedModel} but the classifier resolved ${outcome.model}`,
      resolvedModel: outcome.model,
      inputTokens: outcome.usage?.inputTokens ?? null,
    })
  }

  try {
    const assessments = interpretQualityResponse({
      request: unit.request,
      scope,
      policies: unit.policies,
      answers: outcome.answers,
    })
    return {
      kind: 'assessed',
      assessments,
      resolvedModel: outcome.model,
      inputTokens: outcome.usage?.inputTokens ?? null,
    }
  } catch (error) {
    return failed({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.DecisionUnavailable,
      detail: `interpretation failed: ${describeError(error)}`,
    })
  }
}

function statusOf({
  assessments,
}: {
  assessments: readonly QualityAssessment[]
}): EQualityReviewStatus {
  if (assessments.some((assessment) => assessment.status === EQualityReviewStatus.Completed)) {
    return EQualityReviewStatus.Completed
  }
  return assessments[0]?.status ?? EQualityReviewStatus.Inconclusive
}

type Failure = Extract<UnitResult, { kind: 'failed' }>

const detailOf = ({ failures }: { failures: readonly Failure[] }): string | undefined =>
  failures.length === 0 ? undefined : failures.map((failure) => failure.detail).join('; ')

export async function reviewScopeJob({
  classifier,
  requestedModel,
  job,
  signal,
}: {
  classifier: ClassifierPort
  requestedModel: string
  job: ScopeJob
  signal: AbortSignal
}): Promise<UnitResult[]> {
  const executed = await Promise.all(
    job.plan.units.map((unit) =>
      executeUnit({ classifier, requestedModel, scope: job.scope, unit, signal }),
    ),
  )
  const rejected = job.plan.rejected.map(
    (entry): UnitResult => ({ kind: 'failed', ...entry, inputTokens: null }),
  )
  return [...executed, ...rejected]
}

export function recordScope({
  callId,
  job,
  results,
  previous,
  durationMs,
  requestedModel,
}: {
  callId: CallId
  job: ScopeJob
  results: readonly UnitResult[]
  previous: readonly QualityFinding[]
  durationMs: number
  requestedModel: string
}): { item: ReviewItem; findings: readonly QualityFinding[] } {
  const { scope, path } = job
  const base = {
    callId,
    workspaceNamespace: scope.workspaceNamespace,
    path,
    scope,
    durationMs,
    requestedModel,
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
  const step = applyAssessments({
    previous,
    assessments,
    afterHash: scope.afterHash,
    scopeDeleted: false,
  })
  const policies = job.plan.units.flatMap((unit) => unit.policies)
  const notifiable = step.notifiable.flatMap((finding): NotifiableEntry[] => {
    const assessment = assessments.find((candidate) => candidate.policyId === finding.policyId)
    const policy = policies.find((candidate) => candidate.id === finding.policyId)
    return assessment === undefined || policy === undefined
      ? []
      : [{ finding, assessment, scope, policy }]
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
