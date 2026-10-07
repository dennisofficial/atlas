import type { EvalFeature, EvaluatorGrade } from './feature'

export enum EScoreErrorKind {
  OutOfRange = 'out_of_range',
  NonFinite = 'non_finite',
  Missing = 'missing',
}

export class ScoringError extends Error {
  readonly kind: EScoreErrorKind
  readonly evaluatorId: string

  constructor({ kind, evaluatorId, message }: { kind: EScoreErrorKind; evaluatorId: string; message: string }) {
    super(message)
    this.name = 'ScoringError'
    this.kind = kind
    this.evaluatorId = evaluatorId
  }
}

export function validateGrade({ evaluatorId, grade }: { evaluatorId: string; grade: EvaluatorGrade }): number {
  const score: unknown = grade.score
  if (typeof score !== 'number') {
    throw new ScoringError({
      kind: EScoreErrorKind.Missing,
      evaluatorId,
      message: `evaluator "${evaluatorId}" returned no numeric score`,
    })
  }
  if (!Number.isFinite(score)) {
    throw new ScoringError({
      kind: EScoreErrorKind.NonFinite,
      evaluatorId,
      message: `evaluator "${evaluatorId}" returned a non-finite score (${score})`,
    })
  }
  if (score < 0 || score > 1) {
    throw new ScoringError({
      kind: EScoreErrorKind.OutOfRange,
      evaluatorId,
      message: `evaluator "${evaluatorId}" returned score ${score} outside [0, 1]`,
    })
  }
  return score
}

export function gradeRow<TInput, TExpected, TOutput>({
  feature,
  input,
  expected,
  actual,
}: {
  feature: EvalFeature<TInput, TExpected, TOutput>
  input: TInput
  expected: TExpected
  actual: TOutput
}): Record<string, number> {
  const scores: Record<string, number> = {}
  for (const evaluator of feature.evaluators) {
    if (!evaluator.applies({ input, expected })) continue
    const grade = evaluator.grade({ input, expected, actual })
    scores[evaluator.id] = validateGrade({ evaluatorId: evaluator.id, grade })
  }
  return scores
}
