import type { EvalCase } from './case'
import { gradeRow, ScoringError } from './grading'
import type { AnyEvalFeature } from './feature-registry'
import { ERowStatus, type ResultRow } from './results'
import type { PlannedRow } from './run-plan'

export class TaskExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskExecutionError'
  }
}

export type WorkerContext = {
  invocationId: string
  model: string
  deadlineMs: number
  monotonicNow?: (() => number) | undefined
}

const defaultNow = (): number => Date.now()

export function monotonicMs({ context }: { context: WorkerContext }): number {
  const now = context.monotonicNow ?? defaultNow
  return now()
}

export async function executeRow({
  feature,
  evalCase,
  row,
  context,
}: {
  feature: AnyEvalFeature
  evalCase: EvalCase
  row: PlannedRow
  context: WorkerContext
}): Promise<ResultRow> {
  const now = () => monotonicMs({ context })
  const started = now()

  const input = feature.inputSchema.parse(evalCase.input)
  const expected = feature.expectedSchema.parse(evalCase.expected)

  let actual: unknown
  try {
    actual = await feature.run({
      input,
      context: {
        invocationId: context.invocationId,
        caseId: row.caseId,
        trialId: row.trialId,
        variantId: row.variantId,
        model: context.model,
        deadlineMs: context.deadlineMs,
      },
    })
  } catch (fault) {
    return {
      caseId: row.caseId,
      trialId: row.trialId,
      variantId: row.variantId,
      status: ERowStatus.TaskError,
      expected,
      actual: null,
      scores: {},
      error: fault instanceof Error ? fault.message : String(fault),
      timing: { preparationMs: 0, inferenceMs: 0, interpretationMs: 0, endToEndMs: now() - started },
    }
  }

  const outputParsed = feature.outputSchema.safeParse(actual)
  if (!outputParsed.success) {
    return {
      caseId: row.caseId,
      trialId: row.trialId,
      variantId: row.variantId,
      status: ERowStatus.TaskError,
      expected,
      actual: null,
      scores: {},
      error: `task output failed the feature output schema: ${outputParsed.error.issues[0]?.message ?? 'unknown'}`,
      timing: { preparationMs: 0, inferenceMs: 0, interpretationMs: 0, endToEndMs: now() - started },
    }
  }

  try {
    const scores = gradeRow({ feature, input, expected, actual: outputParsed.data })
    return {
      caseId: row.caseId,
      trialId: row.trialId,
      variantId: row.variantId,
      status: ERowStatus.Completed,
      expected,
      actual: outputParsed.data,
      scores,
      timing: { preparationMs: 0, inferenceMs: 0, interpretationMs: 0, endToEndMs: now() - started },
    }
  } catch (fault) {
    if (fault instanceof ScoringError) {
      return {
        caseId: row.caseId,
        trialId: row.trialId,
        variantId: row.variantId,
        status: ERowStatus.ScorerError,
        expected,
        actual: outputParsed.data,
        scores: {},
        error: fault.message,
        timing: { preparationMs: 0, inferenceMs: 0, interpretationMs: 0, endToEndMs: now() - started },
      }
    }
    throw fault
  }
}

export async function executePlan({
  feature,
  cases,
  rows,
  context,
}: {
  feature: AnyEvalFeature
  cases: readonly EvalCase[]
  rows: readonly PlannedRow[]
  context: WorkerContext
}): Promise<readonly ResultRow[]> {
  const byId = new Map(cases.map((evalCase) => [evalCase.id, evalCase]))
  const results: ResultRow[] = []
  for (const row of rows) {
    const evalCase = byId.get(row.caseId)
    if (evalCase === undefined) throw new TaskExecutionError(`no case for planned row ${row.caseId}`)
    results.push(await executeRow({ feature, evalCase, row, context }))
  }
  return results
}
