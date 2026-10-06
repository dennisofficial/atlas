import { describe, expect, it } from 'bun:test'
import { ERunExitCode, ERunMode, ERunStatus } from '../results'
import type { LoadedRun, RunSummary } from '../results'
import { compareRuns, evaluateRun, formatComparisonText, formatSummaryText } from '../summary'

const stats = { p50: 10, p95: 20, samples: 4 }

const makeSummary = ({ overrides }: { overrides?: Partial<RunSummary> | undefined } = {}): RunSummary => ({
  status: ERunStatus.Complete,
  invocationId: 'inv-1',
  featureId: 'calculator',
  datasetVersion: 'v1',
  datasetHash: 'hash-a',
  model: { requested: 'model-x', resolved: null },
  mode: ERunMode.Fake,
  planned: { uniqueCases: 2, rows: 4, trialsPerCase: 2, variants: ['default'] },
  completed: 4,
  errors: 0,
  inconclusive: 0,
  operationalFailures: 0,
  repeatFlips: 0,
  metrics: [{ id: 'accuracy', kind: 'ratio', value: 0.9, numerator: 9, denominator: 10 }],
  datasetAggregates: [],
  failures: [],
  timing: {
    preparationMs: stats,
    inferenceMs: stats,
    interpretationMs: stats,
    gradingMs: stats,
    endToEndMs: stats,
    childOverheadMs: 5,
  },
  baselineComparison: null,
  promotable: true,
  failureNotes: [],
  ...overrides,
})

const makeRun = ({ overrides }: { overrides?: Partial<RunSummary> | undefined } = {}): LoadedRun => ({
  summary: makeSummary({ overrides }),
  rows: [],
  directory: '/tmp/run',
})

const gates = [{ metricId: 'accuracy', min: 0.8 }]

describe('evaluateRun', () => {
  it('passes when every gate is met', () => {
    expect(evaluateRun({ summary: makeSummary(), gates })).toEqual({
      exitCode: ERunExitCode.Success,
      status: ERunStatus.Complete,
      notes: [],
    })
  })

  it('treats a value exactly at the minimum as passing', () => {
    const summary = makeSummary({
      overrides: { metrics: [{ id: 'accuracy', kind: 'ratio', value: 0.8, numerator: 8, denominator: 10 }] },
    })
    expect(evaluateRun({ summary, gates }).exitCode).toBe(ERunExitCode.Success)
  })

  it('flags a quality regression below the minimum, naming metric, baseline and candidate', () => {
    const summary = makeSummary({
      overrides: {
        metrics: [{ id: 'accuracy', kind: 'ratio', value: 0.5, numerator: 5, denominator: 10 }],
        baselineComparison: {
          baselineInvocationId: 'base',
          comparable: true,
          deltas: [{ metricId: 'accuracy', baseline: 0.9, candidate: 0.5, delta: -0.4 }],
        },
      },
    })
    const result = evaluateRun({ summary, gates })
    expect(result.exitCode).toBe(ERunExitCode.QualityRegression)
    expect(result.status).toBe(ERunStatus.QualityRegression)
    expect(result.notes).toEqual(['accuracy: baseline 0.900, candidate 0.500, required >= 0.8'])
  })

  it('treats a null metric value as a regression', () => {
    const summary = makeSummary({
      overrides: { metrics: [{ id: 'accuracy', kind: 'ratio', value: null, numerator: 0, denominator: 0 }] },
    })
    expect(evaluateRun({ summary, gates }).exitCode).toBe(ERunExitCode.QualityRegression)
  })

  it('treats a missing gated metric as a regression', () => {
    expect(evaluateRun({ summary: makeSummary({ overrides: { metrics: [] } }), gates }).exitCode).toBe(
      ERunExitCode.QualityRegression,
    )
  })

  it.each([ERunStatus.ExecutionFailure, ERunStatus.IntegrityFailure])('exits 2 for summary status %p', (status) => {
    const result = evaluateRun({ summary: makeSummary({ overrides: { status, failureNotes: ['bad'] } }), gates })
    expect(result).toEqual({ exitCode: ERunExitCode.ExecutionOrIntegrityFailure, status, notes: ['bad'] })
  })

  it('exits 2 on operational failures', () => {
    const result = evaluateRun({ summary: makeSummary({ overrides: { operationalFailures: 2 } }), gates })
    expect(result.exitCode).toBe(ERunExitCode.ExecutionOrIntegrityFailure)
    expect(result.status).toBe(ERunStatus.ExecutionFailure)
    expect(result.notes).toContain('2 operational failure(s)')
  })

  it('exits 2 when completed rows differ from planned rows', () => {
    const result = evaluateRun({ summary: makeSummary({ overrides: { completed: 3 } }), gates })
    expect(result.exitCode).toBe(ERunExitCode.ExecutionOrIntegrityFailure)
    expect(result.notes).toEqual(['completed 3 of 4 planned rows'])
  })
})

describe('compareRuns', () => {
  it('computes deltas and a promotable verdict for comparable runs', () => {
    const baseline = makeRun()
    const candidate = makeRun({
      overrides: { invocationId: 'inv-2', metrics: [{ id: 'accuracy', kind: 'ratio', value: 0.95, numerator: 19, denominator: 20 }] },
    })
    const comparison = compareRuns({ baseline, candidate })
    expect(comparison.comparable).toBe(true)
    expect(comparison.baselineInvocationId).toBe('inv-1')
    expect(comparison.deltas).toHaveLength(1)
    expect(comparison.deltas[0]?.delta).toBeCloseTo(0.05)
    expect(comparison.verdict).toEqual({ promotable: true, regressionNotes: [] })
  })

  it('lists metrics with negative deltas as regressions', () => {
    const candidate = makeRun({
      overrides: { metrics: [{ id: 'accuracy', kind: 'ratio', value: 0.7, numerator: 7, denominator: 10 }] },
    })
    const comparison = compareRuns({ baseline: makeRun(), candidate })
    expect(comparison.verdict.regressionNotes).toEqual(['accuracy: 0.900 -> 0.700'])
  })

  it('uses null delta when either side is null', () => {
    const candidate = makeRun({
      overrides: { metrics: [{ id: 'accuracy', kind: 'ratio', value: null, numerator: 0, denominator: 0 }] },
    })
    const comparison = compareRuns({ baseline: makeRun(), candidate })
    expect(comparison.deltas[0]).toEqual({ metricId: 'accuracy', baseline: 0.9, candidate: null, delta: null })
    expect(comparison.verdict.regressionNotes).toEqual([])
  })

  it('is not promotable when the candidate is not itself promotable', () => {
    const candidate = makeRun({ overrides: { promotable: false } })
    expect(compareRuns({ baseline: makeRun(), candidate }).verdict.promotable).toBe(false)
  })

  it('refuses mismatched identity and names each differing field', () => {
    const candidate = makeRun({
      overrides: { datasetHash: 'hash-b', model: { requested: 'model-y', resolved: null }, mode: ERunMode.Live },
    })
    const comparison = compareRuns({ baseline: makeRun(), candidate })
    expect(comparison.comparable).toBe(false)
    expect(comparison.deltas).toEqual([])
    expect(comparison.mismatchReason).toContain('datasetHash')
    expect(comparison.mismatchReason).toContain('model.requested')
    expect(comparison.mismatchReason).toContain('mode')
    expect(comparison.mismatchReason).not.toContain('datasetVersion')
    expect(comparison.verdict.promotable).toBe(false)
    expect(comparison.verdict.regressionNotes[0]).toStartWith('comparison mismatch: ')
  })

  it('detects datasetVersion and featureId mismatches', () => {
    const candidate = makeRun({ overrides: { datasetVersion: 'v2', featureId: 'other' } })
    const reason = compareRuns({ baseline: makeRun(), candidate }).mismatchReason
    expect(reason).toContain('datasetVersion')
    expect(reason).toContain('featureId')
  })
})

describe('formatSummaryText', () => {
  it('renders a compact summary with metrics, timing and verdict', () => {
    const text = formatSummaryText({ summary: makeSummary() })
    expect(text).toContain('status: complete')
    expect(text).toContain('cases 2')
    expect(text).toContain('accuracy: 0.900 [9/10]')
    expect(text).toContain('inference: p50 10ms p95 20ms (n=4)')
    expect(text).toContain('promotable: yes')
    expect(text).not.toContain('failures:')
  })

  it('includes baseline deltas when a comparison is present', () => {
    const summary = makeSummary({
      overrides: {
        baselineComparison: {
          baselineInvocationId: 'base',
          comparable: true,
          deltas: [{ metricId: 'accuracy', baseline: 0.8, candidate: 0.9, delta: 0.1 }],
        },
      },
    })
    expect(formatSummaryText({ summary })).toContain('(+0.100 vs baseline)')
  })

  it('caps failure lines at ten and reports the remainder', () => {
    const failures = Array.from({ length: 13 }, (_, index) => ({ caseId: `case-${index}`, expected: 'a', actual: 'b' }))
    const text = formatSummaryText({ summary: makeSummary({ overrides: { failures, promotable: false, failureNotes: ['too many'] } }) })
    expect(text).toContain('case-0 a->b')
    expect(text).toContain('case-9 a->b')
    expect(text).not.toContain('case-10 a->b')
    expect(text).toContain('… and 3 more')
    expect(text).toContain('promotable: no')
    expect(text).toContain('note: too many')
  })

  it('prints n/a for null metric values and timings', () => {
    const summary = makeSummary({
      overrides: {
        metrics: [{ id: 'accuracy', kind: 'ratio', value: null, numerator: 0, denominator: 0 }],
        timing: { ...makeSummary().timing, gradingMs: { p50: null, p95: null, samples: 0 } },
      },
    })
    const text = formatSummaryText({ summary })
    expect(text).toContain('accuracy: n/a [0/0]')
    expect(text).toContain('grading: p50 n/a p95 n/a (n=0)')
  })
})

describe('formatComparisonText', () => {
  it('renders deltas and verdict for comparable runs', () => {
    const baseline = makeRun()
    const candidate = makeRun({
      overrides: { invocationId: 'inv-2', metrics: [{ id: 'accuracy', kind: 'ratio', value: 0.7, numerator: 7, denominator: 10 }] },
    })
    const comparison = compareRuns({ baseline, candidate })
    const text = formatComparisonText({ comparison, baseline, candidate })
    expect(text).toContain('baseline inv-1 vs candidate inv-2')
    expect(text).toContain('comparable: yes')
    expect(text).toContain('accuracy: 0.900 -> 0.700 (-0.200)')
    expect(text).toContain('promotable: yes')
    expect(text).toContain('note: accuracy: 0.900 -> 0.700')
  })

  it('renders the mismatch reason when not comparable', () => {
    const baseline = makeRun()
    const candidate = makeRun({ overrides: { datasetHash: 'hash-b' } })
    const comparison = compareRuns({ baseline, candidate })
    const text = formatComparisonText({ comparison, baseline, candidate })
    expect(text).toContain('comparable: no')
    expect(text).toContain('mismatch: mismatched datasetHash')
    expect(text).toContain('promotable: no')
  })
})
