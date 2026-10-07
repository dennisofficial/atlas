import {
  applyAssessments,
  EQualityReviewStatus,
  singleResponsibilityPolicy,
  type QualityAssessment,
} from '@dltech/atlas-core'

import { ERowStatus, type ResultRow } from '../src/results'
import type { PlannedRow } from '../src/run-plan'
import { codeQualityOutputSchema } from './feature'
import { srpAssessmentOf } from './grading'
import { EfficacyInputError, type PreparedCase } from './efficacy-judgment'
import {
  EOperationalReason,
  EStructuralReason,
  ERowClass,
  type ClassifiedRow,
  type RowIdentity,
} from './efficacy-types'

export const identityKey = ({ caseId, trialId, variantId }: RowIdentity): string => JSON.stringify([caseId, trialId, variantId])

const STATUS_REASONS: Readonly<Record<ERowStatus, EOperationalReason | null>> = {
  [ERowStatus.Completed]: null,
  [ERowStatus.TaskError]: EOperationalReason.TaskError,
  [ERowStatus.ScorerError]: EOperationalReason.ScorerError,
  [ERowStatus.Skipped]: EOperationalReason.Skipped,
}

export function planOf({ cases, rows, plan }: { cases: readonly PreparedCase[]; rows: readonly ResultRow[]; plan: readonly PlannedRow[] | undefined }): readonly RowIdentity[] {
  if (plan !== undefined) return plan
  const pairs = new Map<string, { trialId: string; variantId: string }>()
  for (const row of rows) pairs.set(JSON.stringify([row.trialId, row.variantId]), { trialId: row.trialId, variantId: row.variantId })
  return cases.flatMap((prepared) => [...pairs.values()].map((pair) => ({ caseId: prepared.evalCase.id, ...pair })))
}

function wasNotified({ prepared, assessment }: { prepared: PreparedCase; assessment: QualityAssessment }): boolean {
  if (assessment.status !== EQualityReviewStatus.Completed) return false
  const scope = prepared.scope
  const selectable = singleResponsibilityPolicy.selectScopes({ scopes: [scope] }).includes(scope.id)
  if (!selectable) return false
  const step = applyAssessments({ previous: [], assessments: [assessment], afterHash: scope.afterHash, scopeDeleted: scope.after === null })
  return step.notifiable.length > 0
}

function classifyRow({ row, prepared, requestedModel }: { row: ResultRow; prepared: PreparedCase; requestedModel: string | undefined }): ClassifiedRow {
  const identity = { caseId: row.caseId, trialId: row.trialId, variantId: row.variantId }
  const unavailable = (rowClass: ERowClass.Operational | ERowClass.Structural, reason: EOperationalReason | EStructuralReason): ClassifiedRow => ({ rowClass, identity, prepared, reason })
  const statusReason = STATUS_REASONS[row.status]
  if (statusReason !== null) return unavailable(ERowClass.Operational, statusReason)
  const output = codeQualityOutputSchema.safeParse(row.actual)
  if (!output.success) return unavailable(ERowClass.Structural, EStructuralReason.MalformedOutput)
  if (requestedModel !== undefined && output.data.resolvedModel !== requestedModel) {
    return unavailable(ERowClass.Operational, EOperationalReason.ModelIdentity)
  }
  const matching = output.data.assessments.filter((assessment) => assessment.policyId === 'single-responsibility')
  if (matching.length > 1) return unavailable(ERowClass.Structural, EStructuralReason.DuplicateAssessment)
  const assessment = matching[0]
  if (assessment === undefined) return unavailable(ERowClass.Structural, EStructuralReason.MissingAssessment)
  if (assessment.scopeId !== prepared.scope.id) return unavailable(ERowClass.Structural, EStructuralReason.ScopeMismatch)
  if (assessment.policyVersion !== singleResponsibilityPolicy.version) return unavailable(ERowClass.Structural, EStructuralReason.ScopeMismatch)
  if (JSON.stringify(row.expected) !== JSON.stringify(prepared.evalCase.expected)) {
    return unavailable(ERowClass.Structural, EStructuralReason.ExpectedMismatch)
  }
  const suppliedEvidence = new Set(prepared.scope.evidence.map((entry) => entry.id))
  if (assessment.evidenceIds.some((id) => !suppliedEvidence.has(id))) {
    return unavailable(ERowClass.Structural, EStructuralReason.UnknownEvidence)
  }
  if (assessment.status === EQualityReviewStatus.OperationalError) {
    return unavailable(ERowClass.Operational, EOperationalReason.AssessmentOperationalError)
  }
  return {
    rowClass: ERowClass.Interpretable,
    identity,
    prepared,
    assessment,
    notified: wasNotified({ prepared, assessment }),
    endToEndMs: row.timing.endToEndMs,
    inferenceMs: row.timing.inferenceMs,
  }
}

export function classifyRows({
  cases,
  rows,
  plan,
  requestedModel,
}: {
  cases: readonly PreparedCase[]
  rows: readonly ResultRow[]
  plan: readonly PlannedRow[] | undefined
  requestedModel: string | undefined
}): readonly ClassifiedRow[] {
  const problems: string[] = []
  const byCase = new Map(cases.map((prepared) => [prepared.evalCase.id, prepared]))
  const seen = new Map<string, ResultRow>()
  for (const row of rows) {
    const key = identityKey(row)
    if (!byCase.has(row.caseId)) problems.push(`row for unknown case "${row.caseId}"`)
    else if (seen.has(key)) problems.push(`duplicate row ${row.caseId}/${row.trialId}/${row.variantId}`)
    else seen.set(key, row)
  }
  const planned = planOf({ cases, rows, plan })
  const plannedKeys = new Set(planned.map(identityKey))
  for (const identity of planned) {
    if (!byCase.has(identity.caseId)) problems.push(`planned row for unknown case "${identity.caseId}"`)
  }
  for (const [key, row] of seen) {
    if (!plannedKeys.has(key)) problems.push(`row ${row.caseId}/${row.trialId}/${row.variantId} is not in the planned rows`)
  }
  if (problems.length > 0) throw new EfficacyInputError({ problems })
  return planned.map((identity) => {
    const prepared = byCase.get(identity.caseId) as PreparedCase
    const row = seen.get(identityKey(identity))
    if (row === undefined) return { rowClass: ERowClass.Operational, identity, prepared, reason: EOperationalReason.Missing }
    return classifyRow({ row, prepared, requestedModel })
  })
}
