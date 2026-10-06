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

export function failureSummary({ request, invocationId, dataset, notes }: {
  request: RunRequest
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

export function assembleSummary({ request, invocationId, feature, normalized, plannedRows, planned }: {
  request: RunRequest
  invocationId: string
  feature: AnyEvalFeature
  normalized: readonly ResultRow[]
  plannedRows: readonly PlannedRow[]
  planned: { uniqueCases: number; trialsPerCase: number; variants: readonly string[]; datasetVersion: string; datasetHash: string }
}): RunSummary {
  const completedRows = normalized.filter((row) => row.status === ERowStatus.Completed)
  const errorRows = normalized.filter((row) => row.status !== ERowStatus.Completed)

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
    planned: {
      uniqueCases: planned.uniqueCases,
      rows: plannedRows.length,
      trialsPerCase: planned.trialsPerCase,
      variants: planned.variants,
    },
    completed: completedRows.length,
    errors: errorRows.length,
    inconclusive: 0,
    operationalFailures: errorRows.length,
    repeatFlips: repeatFlipCount({ rowsByCase: groupCompletedTrials({ rows: completedRows }) }),
    metrics,
    datasetAggregates: [...featureAggregates],
    failures: [],
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

export function buildRunManifest({ request, invocationId, startedAt, rows, variants, uniqueCases, dataset }: {
  request: RunRequest
  invocationId: string
  startedAt: Date
  rows: readonly PlannedRow[]
  variants: readonly string[]
  uniqueCases: number
  dataset: { version: string; hash: string; path: string }
}): RunManifest {
  return {
    schemaVersion: RUN_MANIFEST_SCHEMA_VERSION,
    invocationId,
    featureId: request.suite,
    mode: request.mode,
    dataset,
    code: { adapterDigest: 'unbuilt', supervisorDigest: 'unbuilt' },
    model: request.model,
    enabledPolicyIds: [],
    batchMode: 'batched',
    planned: { uniqueCases, trialsPerCase: request.trials, variants, rows },
    deadlineMs: request.deadlineMs ?? 10000,
    concurrency: 4,
    cacheDisabled: request.trials > 1,
    startedAt: startedAt.toISOString(),
  }
}
