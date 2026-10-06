import { ERunExitCode, ERunStatus } from './results'
import type { BaselineComparison, ComparisonVerdict, LoadedRun, MetricGate, RunSummary, TimingStats } from './results'

export type RunEvaluation = {
  exitCode: ERunExitCode
  status: ERunStatus
  notes: readonly string[]
}

export type RunComparison = BaselineComparison & { verdict: ComparisonVerdict }

const MAX_FAILURE_LINES = 10

const formatValue = ({ value }: { value: number | null }): string => (value === null ? 'n/a' : value.toFixed(3))

const formatDelta = ({ value }: { value: number | null }): string => {
  if (value === null) return 'n/a'
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`
}

const formatMs = ({ value }: { value: number | null }): string => (value === null ? 'n/a' : `${Math.round(value)}ms`)

const baselineValueFor = ({ summary, metricId }: { summary: RunSummary; metricId: string }): number | null =>
  summary.baselineComparison?.deltas.find((delta) => delta.metricId === metricId)?.baseline ?? null

const gateRegressionNotes = ({ summary, gates }: { summary: RunSummary; gates: readonly MetricGate[] }): string[] => {
  const notes: string[] = []
  for (const gate of gates) {
    const candidate = summary.metrics.find((metric) => metric.id === gate.metricId)?.value ?? null
    if (candidate !== null && candidate >= gate.min) continue
    const baseline = baselineValueFor({ summary, metricId: gate.metricId })
    notes.push(
      `${gate.metricId}: baseline ${formatValue({ value: baseline })}, candidate ${formatValue({ value: candidate })}, required >= ${gate.min}`,
    )
  }
  return notes
}

const executionNotes = ({ summary }: { summary: RunSummary }): string[] => {
  const notes: string[] = []
  if (summary.operationalFailures > 0) notes.push(`${summary.operationalFailures} operational failure(s)`)
  if (summary.completed !== summary.planned.rows) {
    notes.push(`completed ${summary.completed} of ${summary.planned.rows} planned rows`)
  }
  return notes
}

export function evaluateRun({ summary, gates }: { summary: RunSummary; gates: readonly MetricGate[] }): RunEvaluation {
  const failureExit = ERunExitCode.ExecutionOrIntegrityFailure
  if (summary.status === ERunStatus.IntegrityFailure || summary.status === ERunStatus.ExecutionFailure) {
    return { exitCode: failureExit, status: summary.status, notes: [...summary.failureNotes] }
  }
  const execution = executionNotes({ summary })
  if (execution.length > 0) return { exitCode: failureExit, status: ERunStatus.ExecutionFailure, notes: execution }
  const regressions = gateRegressionNotes({ summary, gates })
  if (regressions.length > 0) {
    return { exitCode: ERunExitCode.QualityRegression, status: ERunStatus.QualityRegression, notes: regressions }
  }
  return { exitCode: ERunExitCode.Success, status: ERunStatus.Complete, notes: [] }
}

const identityDifferences = ({ baseline, candidate }: { baseline: RunSummary; candidate: RunSummary }): string[] => {
  const fields: { name: string; baseline: string; candidate: string }[] = [
    { name: 'datasetVersion', baseline: baseline.datasetVersion, candidate: candidate.datasetVersion },
    { name: 'datasetHash', baseline: baseline.datasetHash, candidate: candidate.datasetHash },
    { name: 'featureId', baseline: baseline.featureId, candidate: candidate.featureId },
    { name: 'model.requested', baseline: baseline.model.requested, candidate: candidate.model.requested },
    { name: 'mode', baseline: baseline.mode, candidate: candidate.mode },
  ]
  return fields
    .filter((field) => field.baseline !== field.candidate)
    .map((field) => `${field.name} (${field.baseline} vs ${field.candidate})`)
}

const metricDeltas = ({ baseline, candidate }: { baseline: RunSummary; candidate: RunSummary }): BaselineComparison['deltas'] =>
  candidate.metrics.map((metric) => {
    const baselineValue = baseline.metrics.find((entry) => entry.id === metric.id)?.value ?? null
    const delta = baselineValue === null || metric.value === null ? null : metric.value - baselineValue
    return { metricId: metric.id, baseline: baselineValue, candidate: metric.value, delta }
  })

export function compareRuns({ baseline, candidate }: { baseline: LoadedRun; candidate: LoadedRun }): RunComparison {
  const baselineInvocationId = baseline.summary.invocationId
  const differences = identityDifferences({ baseline: baseline.summary, candidate: candidate.summary })
  if (differences.length > 0) {
    const mismatchReason = `mismatched ${differences.join(', ')}`
    return {
      baselineInvocationId,
      comparable: false,
      mismatchReason,
      deltas: [],
      verdict: { promotable: false, regressionNotes: [`comparison mismatch: ${mismatchReason}`] },
    }
  }
  const deltas = metricDeltas({ baseline: baseline.summary, candidate: candidate.summary })
  const regressionNotes = deltas
    .filter((entry) => entry.delta !== null && entry.delta < 0)
    .map((entry) => `${entry.metricId}: ${formatValue({ value: entry.baseline })} -> ${formatValue({ value: entry.candidate })}`)
  const promotable = candidate.summary.status === ERunStatus.Complete && candidate.summary.promotable
  return { baselineInvocationId, comparable: true, deltas, verdict: { promotable, regressionNotes } }
}

const metricLines = ({ summary }: { summary: RunSummary }): string[] =>
  summary.metrics.map((metric) => {
    const delta = summary.baselineComparison?.deltas.find((entry) => entry.metricId === metric.id)?.delta
    const suffix = delta === undefined ? '' : ` (${formatDelta({ value: delta })} vs baseline)`
    return `  ${metric.id}: ${formatValue({ value: metric.value })} [${metric.numerator}/${metric.denominator}]${suffix}`
  })

const failureLines = ({ summary }: { summary: RunSummary }): string[] => {
  if (summary.failures.length === 0) return []
  const shown = summary.failures.slice(0, MAX_FAILURE_LINES)
  const lines = shown.map((failure) => `  ${failure.caseId} ${failure.expected}->${failure.actual}`)
  const hidden = summary.failures.length - shown.length
  if (hidden > 0) lines.push(`  … and ${hidden} more`)
  return ['failures:', ...lines]
}

const timingLine = ({ phase, stats }: { phase: string; stats: TimingStats }): string =>
  `  ${phase}: p50 ${formatMs({ value: stats.p50 })} p95 ${formatMs({ value: stats.p95 })} (n=${stats.samples})`

const timingLines = ({ summary }: { summary: RunSummary }): string[] => [
  'timing:',
  timingLine({ phase: 'preparation', stats: summary.timing.preparationMs }),
  timingLine({ phase: 'inference', stats: summary.timing.inferenceMs }),
  timingLine({ phase: 'interpretation', stats: summary.timing.interpretationMs }),
  timingLine({ phase: 'grading', stats: summary.timing.gradingMs }),
  timingLine({ phase: 'end-to-end', stats: summary.timing.endToEndMs }),
]

export function formatSummaryText({ summary }: { summary: RunSummary }): string {
  const lines = [
    `status: ${summary.status} | feature ${summary.featureId} | model ${summary.model.requested} | mode ${summary.mode}`,
    `dataset ${summary.datasetVersion} | cases ${summary.planned.uniqueCases} | trials ${summary.completed}/${summary.planned.rows} | errors ${summary.errors} | inconclusive ${summary.inconclusive} | repeat flips ${summary.repeatFlips}`,
    'metrics:',
    ...metricLines({ summary }),
    ...failureLines({ summary }),
    ...timingLines({ summary }),
    `promotable: ${summary.promotable ? 'yes' : 'no'}`,
    ...summary.failureNotes.map((note) => `note: ${note}`),
  ]
  return lines.join('\n')
}

export function formatComparisonText({
  comparison,
  baseline,
  candidate,
}: {
  comparison: RunComparison
  baseline: LoadedRun
  candidate: LoadedRun
}): string {
  const lines = [
    `compare: baseline ${baseline.summary.invocationId} vs candidate ${candidate.summary.invocationId} | feature ${candidate.summary.featureId}`,
    `comparable: ${comparison.comparable ? 'yes' : 'no'}`,
  ]
  if (comparison.mismatchReason !== undefined) lines.push(`mismatch: ${comparison.mismatchReason}`)
  if (comparison.deltas.length > 0) {
    lines.push('metrics:')
    for (const entry of comparison.deltas) {
      lines.push(
        `  ${entry.metricId}: ${formatValue({ value: entry.baseline })} -> ${formatValue({ value: entry.candidate })} (${formatDelta({ value: entry.delta })})`,
      )
    }
  }
  lines.push(`promotable: ${comparison.verdict.promotable ? 'yes' : 'no'}`)
  for (const note of comparison.verdict.regressionNotes) lines.push(`note: ${note}`)
  return lines.join('\n')
}
