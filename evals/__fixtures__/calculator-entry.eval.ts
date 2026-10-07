import { performance } from 'node:perf_hooks'

import { evalite } from 'evalite'

import type { EvalCase } from '../src/case'
import type { PlannedRow } from '../src/run-plan'
import { EScoreErrorKind, ScoringError } from '../src/grading'
import { calculate, createCalculatorFeature, type CalculatorExpected, type CalculatorInput, type CalculatorOutput } from './calculator'

export type CalculatorEntryRow = PlannedRow & { evalCase: EvalCase }

export type EnvelopedCalculatorInput = { caseId: string; trialId: string; variantId: string; input: CalculatorInput }

export function registerCalculatorEval({ rows }: { rows: readonly CalculatorEntryRow[] }): void {
  const feature = createCalculatorFeature({ evaluate: calculate })

  evalite<EnvelopedCalculatorInput, CalculatorOutput, CalculatorExpected>(feature.id, {
    data: rows.map((row) => ({
      input: {
        caseId: row.caseId,
        trialId: row.trialId,
        variantId: row.variantId,
        input: row.evalCase.input as CalculatorInput,
      },
      expected: row.evalCase.expected as CalculatorExpected,
    })),
    trialCount: 1,
    task: async (envelope) => {
      const started = performance.now()
      const output = await feature.run({
        input: envelope.input,
        context: {
          invocationId: 'child',
          caseId: envelope.caseId,
          trialId: envelope.trialId,
          variantId: envelope.variantId,
          model: 'none',
          deadlineMs: 10000,
        },
      })
      void started
      return output
    },
    scorers: feature.evaluators.map((evaluator) => ({
      name: evaluator.id,
      scorer: ({ input: envelope, expected, output }) => {
        const typedExpected = expected as CalculatorExpected
        if (!evaluator.applies({ input: envelope.input, expected: typedExpected })) {
          return { score: 0, metadata: { notApplicable: true } }
        }
        const grade = evaluator.grade({ input: envelope.input, expected: typedExpected, actual: output })
        if (!Number.isFinite(grade.score) || grade.score < 0 || grade.score > 1) {
          throw new ScoringError({
            kind: EScoreErrorKind.OutOfRange,
            evaluatorId: evaluator.id,
            message: `evaluator ${evaluator.id} produced a non-finite or out-of-range score`,
          })
        }
        return { score: grade.score }
      },
    })),
  })
}
