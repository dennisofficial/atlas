import type { z } from 'zod'

export type EvalRunContext = {
  invocationId: string
  caseId: string
  trialId: string
  variantId: string
  model: string
  deadlineMs: number
}

export type EvaluatorGrade = {
  score: number
  difference?: string | undefined
}

export type EvalEvaluator<TInput, TExpected, TOutput> = {
  id: string
  applies(args: { input: TInput; expected: TExpected }): boolean
  grade(args: { input: TInput; expected: TExpected; actual: TOutput }): EvaluatorGrade
}

export type DatasetAggregate = {
  id: string
  counts: Readonly<Record<string, number>>
  ratios: Readonly<Record<string, number | null>>
}

export type DatasetReducerRow<TExpected, TOutput> = {
  caseId: string
  expected: TExpected
  actual: TOutput
  scores: Readonly<Record<string, number>>
}

export type EvalFeature<TInput, TExpected, TOutput> = {
  id: string
  inputSchemaVersion: string
  expectedSchemaVersion: string
  rubricVersion: string
  inputSchema: z.ZodType<TInput>
  expectedSchema: z.ZodType<TExpected>
  outputSchema: z.ZodType<TOutput>
  run(args: { input: TInput; context: EvalRunContext }): Promise<TOutput>
  evaluators: readonly EvalEvaluator<TInput, TExpected, TOutput>[]
  reduceDataset?(args: {
    rows: readonly DatasetReducerRow<TExpected, TOutput>[]
  }): readonly DatasetAggregate[]
}
