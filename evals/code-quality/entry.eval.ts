import { performance } from 'node:perf_hooks'

import { evalite } from 'evalite'

import type { DecisionAnswer } from '@dltech/atlas-core'

import type { EvalCase } from '../src/case'
import type { PlannedRow } from '../src/run-plan'
import { ERunMode } from '../src/results'
import { EScoreErrorKind, ScoringError } from '../src/grading'
import type { LiveConfig } from './transport'
import { createDecisionCaller } from './transport'
import { runCodeQualityTask, type CodeQualityInput, type CodeQualityOutput } from './task'
import { createCodeQualityFeature } from './feature'
import { resolveEvalPolicies } from './policies'
import type { SrpExpected } from './expected'

export type EntryRow = PlannedRow & { evalCase: EvalCase }
export type FakeAnswerMap = Record<string, Record<string, DecisionAnswer>>

export type EntryDependencies = {
  mode: ERunMode
  answers?: FakeAnswerMap | undefined
  liveConfig?: LiveConfig | undefined
  model: string
  deadlineMs: number
}

export type EnvelopedInput = { caseId: string; trialId: string; variantId: string; input: CodeQualityInput }

const rowKey = ({ caseId, trialId, variantId }: { caseId: string; trialId: string; variantId: string }): string =>
  `${caseId}::${trialId}::${variantId}`

function findRowByContent({ rows, state }: { rows: readonly EntryRow[]; state: string }): EntryRow | undefined {
  const parsed = JSON.parse(state) as { scope?: { before?: string | null; after?: string | null } }
  const before = parsed.scope?.before ?? null
  const after = parsed.scope?.after ?? null
  return rows.find((candidate) => {
    const scope = (candidate.evalCase.input as CodeQualityInput).scope
    return (scope.before ?? null) === before && (scope.after ?? null) === after
  })
}

export function registerCodeQualityEval({ deps, rows }: { deps: EntryDependencies; rows: readonly EntryRow[] }): void {
  const decide = createDecisionCaller({
    mode: deps.mode,
    ...(deps.mode === ERunMode.Fake
      ? {
          fakeSystemOne: async (request) => {
            const row = findRowByContent({ rows, state: request.state })
            const key = row === undefined ? '' : rowKey(row)
            const answers = deps.answers?.[key]
            if (answers === undefined) throw new Error(`fake transport has no answers for row ${key}`)
            return { answers, model: request.model }
          },
        }
      : {}),
    ...(deps.liveConfig === undefined ? {} : { liveConfig: deps.liveConfig }),
  })
  const runner = ({ input, model, deadlineMs }: { input: CodeQualityInput; model: string; deadlineMs: number }) =>
    runCodeQualityTask({ input, model, deadlineMs, deps: { decide, resolvePolicies: resolveEvalPolicies } })
  const feature = createCodeQualityFeature({ runner })

  evalite<EnvelopedInput, CodeQualityOutput, SrpExpected>(feature.id, {
    data: rows.map((row) => ({
      input: {
        caseId: row.caseId,
        trialId: row.trialId,
        variantId: row.variantId,
        input: row.evalCase.input as CodeQualityInput,
      },
      expected: row.evalCase.expected as SrpExpected,
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
          model: deps.model,
          deadlineMs: deps.deadlineMs,
        },
      })
      return { ...output, timing: { ...output.timing, endToEndMs: performance.now() - started } }
    },
    scorers: feature.evaluators.map((evaluator) => ({
      name: evaluator.id,
      scorer: ({ input: envelope, expected, output }) => {
        const typedExpected = expected as SrpExpected
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
        return { score: grade.score, ...(grade.difference === undefined ? {} : { metadata: { difference: grade.difference } }) }
      },
    })),
  })
}
