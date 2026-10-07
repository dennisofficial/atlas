import type { AnyEvalFeature } from './feature-registry'
import { exactMatchAccuracy, repeatFlipCount, timingStats } from './metrics'
import { ERunMode, ERunStatus, ERowStatus, type ResultRow, type RunSummary } from './results'
import { RUN_MANIFEST_SCHEMA_VERSION, type PlannedRow, type RunManifest } from './run-plan'
import type { RunRequest } from './supervisor'

export function resolvedModelOf({ rows }: { rows: readonly ResultRow[] }): string | null {
  for (const row of rows) {
    if (typeof row.actual !== 'object' || row.actual === null) continue
    const resolved: unknown = Reflect.get(row.actual, 'resolvedModel')
    if (typeof resolved === 'string') return resolved
  }
  return null
}

export const BATCH_MODE = 'batched'

const MAX_SUMMARY_VALUE_LENGTH = 120

function summarizeValue({ value }: { value: unknown }): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text === undefined) return String(value)
  return text.length > MAX_SUMMARY_VALUE_LENGTH ? `${text.slice(0, MAX_SUMMARY_VALUE_LENGTH)}…` : text
}

function countInconclusive({ rows }: { rows: readonly ResultRow[] }): number {
  let count = 0
  for (const row of rows) {
    if (typeof row.actual !== 'object' || row.actual === null) continue
    const assessments: unknown = Reflect.get(row.actual, 'assessments')
    if (!Array.isArray(assessments)) continue
    for (const assessment of assessments) {
      if (typeof assessment !== 'object' || assessment === null) continue
      if (Reflect.get(assessment, 'status') === 'inconclusive') count += 1
    }
  }
  return count
}

function groupCompletedTrials({ rows }: { rows: readonly ResultRow[] }): ReadonlyMap<string, readonly { trialId: string; passed: boolean }[]> {
  const grouped = new Map<string, { trialId: string; passed: boolean }[]>()
  for (const row of rows) {
    const passed = Object.values(row.scores).every((score) => score === 1)
    const list = grouped.get(row.caseId) ?? []
    list.push({ trialId: row.trialId, passed })
    grouped.set(row.caseId, list)
  }
  return grouped
}

export function failureSummary({ request, invocationId, dataset, notes, enabledPolicyIds }: {
  request: RunRequest
  enabledPolicyIds: readonly string[]
  invocationId: string
  dataset: { version: string; hash: string }
  notes: readonly string[]
}): RunSummary {
  const emptyTiming = { p50: null, p95: null, samples: 0 }
  return {
    status: ERunStatus.ExecutionFailure,
    invocationId,
    featureId: request.suite,
    datasetVersion: dataset.version,
    datasetHash: dataset.hash,
    model: { requested: request.model.requested, resolved: null },
    mode: request.mode,
    enabledPolicyIds,
    batchMode: BATCH_MODE,
    planned: { uniqueCases: 0, rows: 0, trialsPerCase: request.trials, variants: [] },
    completed: 0,
    errors: 0,
    inconclusive: 0,
    operationalFailures: 0,
    repeatFlips: 0,
    metrics: [],
    datasetAggregates: [],
    failures: [],
    timing: {
      preparationMs: emptyTiming,
      inferenceMs: emptyTiming,
      interpretationMs: emptyTiming,
      gradingMs: emptyTiming,
      endToEndMs: emptyTiming,
      childOverheadMs: 0,
    },
    baselineComparison: null,
    promotable: false,
    failureNotes: notes,
  }
}

export function assembleSummary({ request, invocationId, feature, normalized, plannedRows, planned, enabledPolicyIds }: {
  request: RunRequest
  enabledPolicyIds: readonly string[]
  invocationId: string
  feature: AnyEvalFeature
  normalized: readonly ResultRow[]
  plannedRows: readonly PlannedRow[]
  planned: { uniqueCases: number; trialsPerCase: number; variants: readonly string[]; datasetVersion: string; datasetHash: string }
}): RunSummary {
  const completedRows = normalized.filter((row) => row.status === ERowStatus.Completed)
  const errorRows = normalized.filter((row) => row.status !== ERowStatus.Completed)

  const failures = completedRows
    .filter((row) => Object.values(row.scores).some((score) => score < 1))
    .map((row) => ({
      caseId: row.caseId,
      expected: summarizeValue({ value: row.expected }),
      actual: row.difference ?? summarizeValue({ value: row.actual }),
    }))

  const evaluatorIds = [...new Set(completedRows.flatMap((row) => Object.keys(row.scores)))].sort()
  const metrics: RunSummary['metrics'] = evaluatorIds.map((metricId) => {
    const values = completedRows
      .map((row) => row.scores[metricId])
      .filter((value): value is number => typeof value === 'number')
    const exact = exactMatchAccuracy({ matches: values.filter((value) => value === 1).length, total: values.length })
    return { id: metricId, kind: 'exact-match-accuracy', value: exact.value, numerator: exact.numerator, denominator: exact.denominator }
  })
  const featureAggregates = feature.reduceDataset === undefined ? [] : feature.reduceDataset({
    rows: completedRows.map((row) => ({ caseId: row.caseId, expected: row.expected, actual: row.actual, scores: row.scores })),
  })

  const emptyStats = { p50: null, p95: null, samples: 0 }
  return {
    status: ERunStatus.Complete,
    invocationId,
    featureId: request.suite,
    datasetVersion: planned.datasetVersion,
    datasetHash: planned.datasetHash,
    model: { requested: request.model.requested, resolved: resolvedModelOf({ rows: normalized }) },
    mode: request.mode,
    enabledPolicyIds,
    batchMode: BATCH_MODE,
    planned: {
      uniqueCases: planned.uniqueCases,
      rows: plannedRows.length,
      trialsPerCase: planned.trialsPerCase,
      variants: planned.variants,
    },
    completed: completedRows.length,
    errors: errorRows.length,
    inconclusive: countInconclusive({ rows: completedRows }),
    operationalFailures: errorRows.length,
    repeatFlips: repeatFlipCount({ rowsByCase: groupCompletedTrials({ rows: completedRows }) }),
    metrics,
    datasetAggregates: [...featureAggregates],
    failures,
    timing: {
      preparationMs: timingStats({ samples: completedRows.map((row) => row.timing.preparationMs) }),
      inferenceMs: timingStats({ samples: completedRows.map((row) => row.timing.inferenceMs) }),
      interpretationMs: timingStats({ samples: completedRows.map((row) => row.timing.interpretationMs) }),
      gradingMs: emptyStats,
      endToEndMs: timingStats({ samples: completedRows.map((row) => row.timing.endToEndMs) }),
      childOverheadMs: 0,
    },
    baselineComparison: null,
    promotable: request.model.promotable && request.mode === ERunMode.Live,
    failureNotes: [],
  }
}

export function buildRunManifest({ request, invocationId, startedAt, rows, variants, uniqueCases, dataset, codeDigests, enabledPolicyIds, concurrency }: {
  request: RunRequest
  invocationId: string
  startedAt: Date
  rows: readonly PlannedRow[]
  variants: readonly string[]
  uniqueCases: number
  dataset: { version: string; hash: string; path: string }
  codeDigests: { adapterDigest: string; supervisorDigest: string }
  enabledPolicyIds: readonly string[]
  concurrency: number
}): RunManifest {
  return {
    schemaVersion: RUN_MANIFEST_SCHEMA_VERSION,
    invocationId,
    featureId: request.suite,
    mode: request.mode,
    dataset,
    code: codeDigests,
    model: request.model,
    enabledPolicyIds,
    batchMode: BATCH_MODE,
    planned: { uniqueCases, trialsPerCase: request.trials, variants, rows },
    deadlineMs: request.deadlineMs ?? 10000,
    concurrency,
    cacheDisabled: request.trials > 1,
    startedAt: startedAt.toISOString(),
  }
}
