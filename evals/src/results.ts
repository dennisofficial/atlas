export enum ERowStatus {
  Completed = 'completed',
  TaskError = 'task_error',
  ScorerError = 'scorer_error',
  Skipped = 'skipped',
}

export enum ERunStatus {
  Complete = 'complete',
  QualityRegression = 'quality_regression',
  ExecutionFailure = 'execution_failure',
  IntegrityFailure = 'integrity_failure',
}

export enum ERunExitCode {
  Success = 0,
  QualityRegression = 1,
  ExecutionOrIntegrityFailure = 2,
}

export enum ERunMode {
  Fake = 'fake',
  Live = 'live',
}

export type RunTiming = {
  preparationMs: number
  inferenceMs: number
  interpretationMs: number
  endToEndMs: number
}

export type ResultRow = {
  caseId: string
  trialId: string
  variantId: string
  status: ERowStatus
  expected: unknown
  actual: unknown
  scores: Readonly<Record<string, number>>
  error?: string | undefined
  difference?: string | undefined
  timing: RunTiming
}

export type MetricValue = {
  id: string
  kind: string
  value: number | null
  numerator: number
  denominator: number
}

export type RunSummary = {
  status: ERunStatus
  invocationId: string
  featureId: string
  datasetVersion: string
  datasetHash: string
  model: { requested: string; resolved: string | null }
  mode: ERunMode
  enabledPolicyIds: readonly string[]
  batchMode: string
  planned: { uniqueCases: number; rows: number; trialsPerCase: number; variants: readonly string[] }
  completed: number
  errors: number
  inconclusive: number
  operationalFailures: number
  repeatFlips: number
  metrics: readonly MetricValue[]
  datasetAggregates: readonly { id: string; counts: Readonly<Record<string, number>>; ratios: Readonly<Record<string, number | null>> }[]
  failures: readonly { caseId: string; expected: string; actual: string }[]
  timing: { preparationMs: TimingStats; inferenceMs: TimingStats; interpretationMs: TimingStats; gradingMs: TimingStats; endToEndMs: TimingStats; childOverheadMs: number }
  baselineComparison: BaselineComparison | null
  promotable: boolean
  failureNotes: readonly string[]
}

export type TimingStats = { p50: number | null; p95: number | null; samples: number }

export type BaselineComparison = {
  baselineInvocationId: string
  comparable: boolean
  mismatchReason?: string | undefined
  deltas: readonly { metricId: string; baseline: number | null; candidate: number | null; delta: number | null }[]
}

export type ComparisonVerdict = {
  promotable: boolean
  regressionNotes: readonly string[]
}

export type MetricGate = { metricId: string; min: number }

export type LoadedRun = {
  summary: RunSummary
  rows: readonly ResultRow[]
  directory: string
}
