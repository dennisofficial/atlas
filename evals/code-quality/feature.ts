import { z } from 'zod'

import {
  EQualityReviewStatus,
  qualityAssessmentSchema,
  type QualityPolicy,
  type QualityScope,
} from '@dltech/atlas-core'

import type { DatasetAggregate, DatasetReducerRow, EvalFeature } from '../src/feature'
import type { EvaluatorGrade } from '../src/feature'
import { gradeCurrentConcern, gradeEvidenceIds, gradeExactTuple, gradeImpact } from './grading'
import { runCodeQualityTask, type CodeQualityInput, type CodeQualityOutput } from './task'
import { ESrpExpectationKind, srpExpectedSchema, type SrpExpected } from './expected'

export const CODE_QUALITY_FEATURE_ID = 'code-quality/single-responsibility'

const qualityEvidenceSchema = z.object({ id: z.string().min(1), label: z.string(), changed: z.boolean() }).readonly()

const lineRangeSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).nullable()

const qualityScopeSchema: z.ZodType<QualityScope> = z.object({
  id: z.string().min(1),
  workspaceNamespace: z.string().min(1),
  path: z.string().min(1),
  language: z.enum(['typescript', 'javascript']),
  kind: z.enum(['module', 'class', 'method', 'function']),
  name: z.string(),
  adapterVersion: z.string().min(1),
  structuralHash: z.string().min(1),
  parentScopeId: z.string().min(1).nullable(),
  lineRange: lineRangeSchema,
  before: z.string().nullable(),
  after: z.string().nullable(),
  diff: z.string(),
  beforeHash: z.string().nullable(),
  afterHash: z.string().nullable(),
  evidence: z.array(qualityEvidenceSchema).readonly(),
  dependencyContext: z.array(z.string()).readonly(),
  beforeLineRange: lineRangeSchema,
  afterLineRange: lineRangeSchema,
}) as z.ZodType<QualityScope>

export const codeQualityInputSchema: z.ZodType<CodeQualityInput> = z.object({
  scope: qualityScopeSchema,
  policyIds: z.array(z.string().min(1)).readonly(),
})

export const codeQualityOutputSchema: z.ZodType<CodeQualityOutput> = z.object({
  assessments: z.array(qualityAssessmentSchema).readonly(),
  resolvedModel: z.string().nullable(),
  timing: z.object({ preparationMs: z.number(), inferenceMs: z.number(), interpretationMs: z.number() }),
})

export type PolicyResolver = (args: { policyIds: readonly string[] }) => readonly QualityPolicy[]

type Runner = ({ input, model, deadlineMs }: {
  input: CodeQualityInput
  model: string
  deadlineMs: number
}) => Promise<CodeQualityOutput>

export function createCodeQualityFeature({ runner }: { runner: Runner }): EvalFeature<CodeQualityInput, SrpExpected, CodeQualityOutput> {
  return {
    id: CODE_QUALITY_FEATURE_ID,
    inputSchemaVersion: '1',
    expectedSchemaVersion: '1',
    rubricVersion: '1',
    inputSchema: codeQualityInputSchema,
    expectedSchema: srpExpectedSchema,
    outputSchema: codeQualityOutputSchema,
    run: async ({ input, context }) => runner({ input, model: context.model, deadlineMs: context.deadlineMs }),
    evaluators: [
      {
        id: 'srp-exact-tuple',
        applies: () => true,
        grade: ({ expected, actual }): EvaluatorGrade => gradeExactTuple({ expected, actual }),
      },
      {
        id: 'srp-impact',
        applies: ({ expected }) => expected.kind === ESrpExpectationKind.Decided,
        grade: ({ expected, actual }): EvaluatorGrade => gradeImpact({ expected, actual }),
      },
      {
        id: 'srp-current-concern',
        applies: ({ expected }) => expected.kind === ESrpExpectationKind.Decided,
        grade: ({ expected, actual }): EvaluatorGrade => gradeCurrentConcern({ expected, actual }),
      },
      {
        id: 'srp-evidence-ids',
        applies: ({ expected }) => expected.kind === ESrpExpectationKind.Decided,
        grade: ({ expected, actual }): EvaluatorGrade => gradeEvidenceIds({ expected, actual }),
      },
    ],
    reduceDataset: ({ rows }: { rows: readonly DatasetReducerRow<SrpExpected, CodeQualityOutput>[] }) =>
      reduceConfusion({ rows }),
  }
}

function reduceConfusion({ rows }: { rows: readonly DatasetReducerRow<SrpExpected, CodeQualityOutput>[] }): readonly DatasetAggregate[] {
  const counts: Record<string, number> = { tp: 0, fp: 0, tn: 0, fn: 0, abstainCorrect: 0, abstainWrong: 0, decided: 0, abstained: 0 }
  for (const row of rows) {
    const assessment = row.actual.assessments.find((a) => a.policyId === 'single-responsibility')
    const predictedConcern =
      assessment !== undefined && assessment.status === EQualityReviewStatus.Completed &&
      assessment.currentConcernProbability !== null && assessment.currentConcernProbability >= 0.5
    if (row.expected.kind === ESrpExpectationKind.Abstain) {
      counts.abstained = (counts.abstained ?? 0) + 1
      const abstained = assessment === undefined || assessment.status !== EQualityReviewStatus.Completed
      if (abstained) counts.abstainCorrect = (counts.abstainCorrect ?? 0) + 1
      else counts.abstainWrong = (counts.abstainWrong ?? 0) + 1
      continue
    }
    counts.decided = (counts.decided ?? 0) + 1
    const expectedConcern = row.expected.fields.currentConcern
    if (expectedConcern && predictedConcern) counts.tp = (counts.tp ?? 0) + 1
    else if (!expectedConcern && predictedConcern) counts.fp = (counts.fp ?? 0) + 1
    else if (!expectedConcern && !predictedConcern) counts.tn = (counts.tn ?? 0) + 1
    else counts.fn = (counts.fn ?? 0) + 1
  }
  const tp = counts.tp ?? 0
  const fp = counts.fp ?? 0
  const tn = counts.tn ?? 0
  const fn = counts.fn ?? 0
  const ratios: Record<string, number | null> = {
    precision: tp + fp === 0 ? null : tp / (tp + fp),
    recall: tp + fn === 0 ? null : tp / (tp + fn),
    fpr: fp + tn === 0 ? null : fp / (fp + tn),
    abstentionAccuracy:
      (counts.abstained ?? 0) === 0 ? null : (counts.abstainCorrect ?? 0) / (counts.abstained ?? 1),
  }
  const precision = ratios.precision ?? null
  const recall = ratios.recall ?? null
  ratios.f1 = precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall)
  return [{ id: 'srp-confusion', counts, ratios }]
}
