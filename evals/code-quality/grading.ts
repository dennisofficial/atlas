import {
  EQualityReviewStatus,
  type QualityAssessment,
} from '@dltech/atlas-core'

import type { EvaluatorGrade } from '../src/feature'
import type { CodeQualityOutput } from './task'
import { ESrpExpectationKind, type SrpExpected } from './expected'

export type FieldGrades = {
  impact: number
  currentConcern: number
  evidenceIds: number
}

const SRP_POLICY_ID = 'single-responsibility'

export function srpAssessmentOf({ output }: { output: CodeQualityOutput }): QualityAssessment | null {
  for (const assessment of output.assessments) {
    if (assessment.policyId === SRP_POLICY_ID) return assessment
  }
  return null
}

function sortedIds({ ids }: { ids: readonly string[] }): string {
  return [...ids].sort().join(',')
}

export function gradeFieldTuple({
  expected,
  actual,
}: {
  expected: SrpExpected & { kind: ESrpExpectationKind.Decided }
  actual: CodeQualityOutput
}): FieldGrades {
  const assessment = srpAssessmentOf({ output: actual })
  if (assessment === null || assessment.status !== EQualityReviewStatus.Completed) {
    return { impact: 0, currentConcern: 0, evidenceIds: 0 }
  }
  const concernProbability = assessment.currentConcernProbability
  const predictedConcern = concernProbability !== null && concernProbability >= 0.5
  return {
    impact: assessment.impact === expected.fields.impact ? 1 : 0,
    currentConcern: predictedConcern === expected.fields.currentConcern ? 1 : 0,
    evidenceIds: sortedIds({ ids: assessment.evidenceIds }) === sortedIds({ ids: expected.fields.evidenceIds }) ? 1 : 0,
  }
}

export function gradeImpact({ expected, actual }: {
  expected: SrpExpected
  actual: CodeQualityOutput
}): EvaluatorGrade {
  if (expected.kind === ESrpExpectationKind.Abstain) {
    const assessment = srpAssessmentOf({ output: actual })
    const abstained =
      assessment === null ||
      assessment.status === EQualityReviewStatus.Inconclusive ||
      assessment.status === EQualityReviewStatus.Skipped
    return { score: abstained ? 1 : 0, difference: abstained ? undefined : `expected abstention, got ${assessment.status}/${assessment.impact}` }
  }
  const fields = gradeFieldTuple({ expected, actual })
  const assessment = srpAssessmentOf({ output: actual })
  return {
    score: fields.impact,
    difference:
      fields.impact === 1
        ? undefined
        : `expected impact ${expected.fields.impact}, got ${assessment?.impact ?? 'none'}`,
  }
}

export function gradeCurrentConcern({ expected, actual }: {
  expected: SrpExpected
  actual: CodeQualityOutput
}): EvaluatorGrade {
  if (expected.kind === ESrpExpectationKind.Abstain) return { score: 1 }
  const fields = gradeFieldTuple({ expected, actual })
  return { score: fields.currentConcern }
}

export function gradeEvidenceIds({ expected, actual }: {
  expected: SrpExpected
  actual: CodeQualityOutput
}): EvaluatorGrade {
  if (expected.kind === ESrpExpectationKind.Abstain) return { score: 1 }
  const fields = gradeFieldTuple({ expected, actual })
  const assessment = srpAssessmentOf({ output: actual })
  return {
    score: fields.evidenceIds,
    difference:
      fields.evidenceIds === 1
        ? undefined
        : `expected evidence [${sortedIds({ ids: expected.fields.evidenceIds })}], got [${sortedIds({ ids: assessment?.evidenceIds ?? [] })}]`,
  }
}

export function gradeExactTuple({ expected, actual }: {
  expected: SrpExpected
  actual: CodeQualityOutput
}): EvaluatorGrade {
  if (expected.kind === ESrpExpectationKind.Abstain) {
    return gradeImpact({ expected, actual })
  }
  const fields = gradeFieldTuple({ expected, actual })
  const exact = fields.impact + fields.currentConcern + fields.evidenceIds === 3
  return { score: exact ? 1 : 0 }
}
