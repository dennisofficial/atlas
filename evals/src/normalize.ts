import { ERowStatus, type ResultRow } from './results'
import type { PlannedRow } from './run-plan'

export type RawExportResult = {
  input: unknown
  output: unknown
  expected?: unknown
  status: string
  scores: readonly { name: string; score: unknown }[]
  error?: unknown
}

export type RawExport = {
  run: { createdAt: string; runType: string }
  evals: readonly { name: string; results: readonly RawExportResult[] }[]
}

const rowKeyOf = ({ caseId, trialId, variantId }: { caseId: string; trialId: string; variantId: string }): string =>
  `${caseId}::${trialId}::${variantId}`

type Envelope = { caseId: string; trialId: string; variantId: string }

function readEnvelope({ input }: { input: unknown }): Envelope | null {
  if (typeof input !== 'object' || input === null) return null
  const caseId: unknown = Reflect.get(input, 'caseId')
  const trialId: unknown = Reflect.get(input, 'trialId')
  const variantId: unknown = Reflect.get(input, 'variantId')
  if (typeof caseId !== 'string' || typeof trialId !== 'string' || typeof variantId !== 'string') return null
  return { caseId, trialId, variantId }
}

function readTiming({ output }: { output: unknown }): { preparationMs: number; inferenceMs: number; interpretationMs: number; endToEndMs: number } {
  const zero = { preparationMs: 0, inferenceMs: 0, interpretationMs: 0, endToEndMs: 0 }
  if (typeof output !== 'object' || output === null) return zero
  const timing: unknown = Reflect.get(output, 'timing')
  if (typeof timing !== 'object' || timing === null) return zero
  const num = (key: string): number => {
    const value: unknown = Reflect.get(timing, key)
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  return {
    preparationMs: num('preparationMs'),
    inferenceMs: num('inferenceMs'),
    interpretationMs: num('interpretationMs'),
    endToEndMs: num('endToEndMs'),
  }
}

function readScores({ scores }: { scores: readonly { name: string; score: unknown }[] }): Record<string, number> {
  const out: Record<string, number> = {}
  for (const entry of scores) {
    if (typeof entry.score === 'number' && Number.isFinite(entry.score)) out[entry.name] = entry.score
  }
  return out
}

export function normalizeRows({
  raw,
  plannedRows,
}: {
  raw: RawExport
  plannedRows: readonly PlannedRow[]
}): readonly ResultRow[] {
  const results = raw.evals.flatMap((evaluation) => evaluation.results)
  const byKey = new Map<string, RawExportResult>()
  for (const result of results) {
    const envelope = readEnvelope({ input: result.input })
    if (envelope === null) continue
    byKey.set(rowKeyOf(envelope), result)
  }
  return plannedRows.map((planned) => {
    const key = rowKeyOf(planned)
    const result = byKey.get(key)
    if (result === undefined) {
      return {
        caseId: planned.caseId,
        trialId: planned.trialId,
        variantId: planned.variantId,
        status: ERowStatus.TaskError,
        expected: null,
        actual: null,
        scores: {},
        error: 'planned row produced no result',
        timing: { preparationMs: 0, inferenceMs: 0, interpretationMs: 0, endToEndMs: 0 },
      }
    }
    const status = result.status === 'success' ? ERowStatus.Completed : ERowStatus.TaskError
    return {
      caseId: planned.caseId,
      trialId: planned.trialId,
      variantId: planned.variantId,
      status,
      expected: result.expected,
      actual: result.output,
      scores: readScores({ scores: result.scores }),
      ...(result.error === undefined || result.error === null
        ? {}
        : { error: typeof result.error === 'string' ? result.error : JSON.stringify(result.error) }),
      timing: readTiming({ output: result.output }),
    }
  })
}
