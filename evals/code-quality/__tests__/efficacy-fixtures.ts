import {
  EQualityImpact,
  EQualityLanguage,
  EQualityScopeKind,
  JEV_QUALITY_MODEL,
  singleResponsibilityPolicy,
  type QualityAssessment,
  type QualityScope,
} from '@dltech/atlas-core'

import { ECaseReviewState, EVAL_CASE_SCHEMA_VERSION, type EvalCase } from '../../src/case'
import { ERowStatus, type ResultRow } from '../../src/results'
import { CODE_QUALITY_FEATURE_ID } from '../feature'
import { ESrpExpectationKind, type SrpExpected } from '../expected'
import { inputHashOf, type SrpPilotJudgment } from '../efficacy-judgment'

export const MODEL = JEV_QUALITY_MODEL

export function makeScope({ id, kind, evidenceIds }: { id: string; kind: EQualityScopeKind; evidenceIds: readonly string[] }): QualityScope {
  return {
    id,
    workspaceNamespace: 'local:test',
    path: `src/${id}.ts`,
    language: EQualityLanguage.TypeScript,
    kind,
    name: id,
    adapterVersion: '1',
    structuralHash: `structural-${id}`,
    parentScopeId: null,
    lineRange: null,
    before: 'before',
    after: 'after',
    diff: 'diff',
    beforeHash: `before-${id}`,
    afterHash: `after-${id}`,
    evidence: evidenceIds.map((evidenceId) => ({ id: evidenceId, label: evidenceId, changed: true })),
    dependencyContext: [],
    beforeLineRange: null,
    afterLineRange: null,
  }
}

export const decided = ({ impact, concern, evidenceIds = [] }: { impact: EQualityImpact; concern: boolean; evidenceIds?: readonly string[] }): SrpExpected => ({
  kind: ESrpExpectationKind.Decided,
  fields: { impact, currentConcern: concern, evidenceIds },
})

export const abstain: SrpExpected = { kind: ESrpExpectationKind.Abstain }

export function makeCase({
  id,
  expected,
  kind = EQualityScopeKind.Class,
  evidenceIds = ['m1', 'm2'],
  group = `group-${id}`,
}: {
  id: string
  expected: SrpExpected
  kind?: EQualityScopeKind
  evidenceIds?: readonly string[]
  group?: string
}): EvalCase {
  return {
    schemaVersion: EVAL_CASE_SCHEMA_VERSION,
    id,
    featureId: CODE_QUALITY_FEATURE_ID,
    input: { scope: makeScope({ id, kind, evidenceIds }), policyIds: ['single-responsibility'] },
    expected,
    tags: [],
    provenance: { group, method: 'test', sourceHash: `source-${id}`, sourceVersion: '1', completeness: 'complete' },
    review: { state: ECaseReviewState.Accepted, verifications: [] },
  }
}

export const judgmentFor = ({ evalCase, warranted }: { evalCase: EvalCase; warranted: boolean | null }): SrpPilotJudgment => ({
  caseId: evalCase.id,
  inputHash: inputHashOf({ input: evalCase.input }),
  notificationWarranted: warranted,
  rationale: 'synthetic rationale',
  reviewer: 'blind-reviewer-test',
})

export function assess({
  evalCase,
  concern,
  impact,
  impactP = 0.9,
  focus = 'none',
  focusP = 0.9,
}: {
  evalCase: EvalCase
  concern: number
  impact: EQualityImpact
  impactP?: number
  focus?: string
  focusP?: number
}): QualityAssessment {
  const input = evalCase.input as { scope: QualityScope }
  return singleResponsibilityPolicy.interpret({
    scope: input.scope,
    answers: {
      currentConcern: { noul: concern },
      impact: { choice: impact, probabilities: { [impact]: impactP } },
      focus: { choice: focus, probabilities: { [focus]: focusP } },
    },
  })
}

export function abstained({ evalCase }: { evalCase: EvalCase }): QualityAssessment {
  const input = evalCase.input as { scope: QualityScope }
  return singleResponsibilityPolicy.interpret({ scope: input.scope, answers: {} })
}

export const timing = { preparationMs: 1, inferenceMs: 10, interpretationMs: 1, endToEndMs: 12 }

export function rowOf({
  evalCase,
  assessment,
  trialId = 'trial-1',
  variantId = 'default',
  model = MODEL,
  endToEndMs = 12,
}: {
  evalCase: EvalCase
  assessment: QualityAssessment
  trialId?: string
  variantId?: string
  model?: string
  endToEndMs?: number
}): ResultRow {
  return {
    caseId: evalCase.id,
    trialId,
    variantId,
    status: ERowStatus.Completed,
    expected: evalCase.expected,
    actual: { assessments: [assessment], resolvedModel: model, timing: { preparationMs: 1, inferenceMs: 10, interpretationMs: 1 } },
    scores: {},
    timing: { ...timing, endToEndMs },
  }
}

export const failedRow = ({ evalCase, trialId = 'trial-1', status = ERowStatus.TaskError }: { evalCase: EvalCase; trialId?: string; status?: ERowStatus }): ResultRow => ({
  caseId: evalCase.id,
  trialId,
  variantId: 'default',
  status,
  expected: evalCase.expected,
  actual: null,
  scores: {},
  error: 'boom',
  timing: { preparationMs: 0, inferenceMs: 0, interpretationMs: 0, endToEndMs: 0 },
})
