import { JEV_LABEL_MODELS } from './jev-label-answer'
import { fetchVerifiedStates, frameQuery, parseFrameRows, reviewedTraces } from './jev-label-frame'
import type { JevLabeller } from './jev-label-gateway'
import {
  JEV_LABEL_DEFAULT_NEAR_MISS,
  JEV_LABEL_DEFAULT_RANDOM,
  JEV_LABEL_DEFAULT_SEED,
  selectJevLabelSample,
} from './jev-label-sample'
import { itemOf, labelSample, rowOf, type JevLabelItem, type JevLabelRow } from './jev-label-row'
import type { PosthogApi } from './posthog-api'

export const JEV_LABEL_DEFAULT_POLICY_ID = 'single-responsibility'
export const JEV_LABEL_SCORE_DEFINITION_ID = '01a21506-a910-7481-b715-b0ae5e47798c'
export const JEV_LABEL_DATASET_ID = '01a21506-abe3-7d16-b877-3e6cdfa15fa8'
export const JEV_LABEL_REVIEW_QUEUE_ID = '01a21506-aee9-74dd-b7de-2f87c0fdc043'
export const JEV_LABEL_CONCURRENCY = 8

export type JevLabelRun = { rows: readonly JevLabelRow[]; items: readonly JevLabelItem[] }

const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

export async function runWithConcurrency<T, R>({
  values,
  limit,
  run,
}: {
  values: readonly T[]
  limit: number
  run: (value: T) => Promise<R>
}): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, values.length)) }, async () => {
    for (;;) {
      const index = next
      next += 1
      const value = values[index]
      if (value === undefined) return
      results[index] = await run(value)
    }
  })
  await Promise.all(workers)
  return results
}

export async function runJevLabel({
  api,
  labeller,
  since,
  rubric,
  scoreDefinitionId = JEV_LABEL_SCORE_DEFINITION_ID,
  policyId = JEV_LABEL_DEFAULT_POLICY_ID,
  nearMiss = JEV_LABEL_DEFAULT_NEAR_MISS,
  random = JEV_LABEL_DEFAULT_RANDOM,
  seed = JEV_LABEL_DEFAULT_SEED,
  models = JEV_LABEL_MODELS,
  labelledAt = new Date().toISOString(),
  concurrency = JEV_LABEL_CONCURRENCY,
}: {
  api: PosthogApi
  labeller: JevLabeller
  since: string
  rubric: string
  scoreDefinitionId?: string
  policyId?: string
  nearMiss?: number
  random?: number
  seed?: string
  models?: readonly string[]
  labelledAt?: string
  concurrency?: number
}): Promise<JevLabelRun> {
  const reviewed = await reviewedTraces({ api, scoreDefinitionId })
  const frame = parseFrameRows({
    rows: await api.hogql({ query: frameQuery({ since, policyId }) }),
  })
  const samples = selectJevLabelSample({
    rows: frame.filter((row) => !reviewed.has(row.traceId)),
    nearMiss,
    random,
    seed,
  })
  const { states, faults } = await fetchVerifiedStates({
    api,
    generationIds: samples.map((sample) => sample.row.generationId),
  })
  const rows = await runWithConcurrency({
    values: samples,
    limit: concurrency,
    run: async (sample) => {
      const state = states.get(sample.row.generationId)
      if (state === undefined)
        return rowOf({
          sample,
          answers: [],
          models,
          labelledAt,
          error: faults.get(sample.row.generationId) ?? 'the call has no request state',
        })
      try {
        const answers = await labelSample({ sample, state, models, rubric, labeller })
        return rowOf({ sample, answers, models, labelledAt, error: null })
      } catch (fault) {
        return rowOf({ sample, answers: [], models, labelledAt, error: messageOf(fault) })
      }
    },
  })
  const items = rows.flatMap((row) => {
    const state = states.get(row.client_item_id)
    return row.agreed && row.error === null && state !== undefined ? [itemOf({ row, state })] : []
  })
  return { rows, items }
}

export type JevLabelSummary = {
  labelled: number
  agreed: number
  agreement: number | null
  errors: number
  perStratum: readonly { stratum: string; labelled: number; agreed: number }[]
}

export function summarizeJevLabelRows({ rows }: { rows: readonly JevLabelRow[] }): JevLabelSummary {
  const perStratum = new Map<string, { labelled: number; agreed: number }>()
  for (const row of rows) {
    const entry = perStratum.get(row.stratum) ?? { labelled: 0, agreed: 0 }
    entry.labelled += 1
    if (row.agreed) entry.agreed += 1
    perStratum.set(row.stratum, entry)
  }
  const agreed = rows.filter((row) => row.agreed).length
  return {
    labelled: rows.length,
    agreed,
    agreement: rows.length === 0 ? null : agreed / rows.length,
    errors: rows.filter((row) => row.error !== null).length,
    perStratum: [...perStratum].map(([stratum, counts]) => ({ stratum, ...counts })),
  }
}

export function formatJevLabelSummary({ summary }: { summary: JevLabelSummary }): string {
  const strata = summary.perStratum
    .map((entry) => `${entry.stratum} ${entry.agreed}/${entry.labelled}`)
    .join(', ')
  const agreement = summary.agreement === null ? 'n/a' : `${(summary.agreement * 100).toFixed(1)}%`
  return [
    `labelled ${summary.labelled}, agreed ${summary.agreed}, agreement ${agreement}, errors ${summary.errors}`,
    `per stratum: ${strata === '' ? 'none' : strata}`,
  ].join('\n')
}
