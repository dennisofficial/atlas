import { describe, expect, it } from 'bun:test'
import {
  confusionCounts,
  exactMatchAccuracy,
  meanScore,
  precisionRecallF1,
  repeatFlipCount,
  timingStats,
} from '../metrics'

describe('confusionCounts', () => {
  it('tallies each quadrant', () => {
    const counts = confusionCounts({
      rows: [
        { expectedPositive: true, predictedPositive: true },
        { expectedPositive: true, predictedPositive: true },
        { expectedPositive: false, predictedPositive: true },
        { expectedPositive: false, predictedPositive: false },
        { expectedPositive: true, predictedPositive: false },
      ],
    })
    expect(counts).toEqual({ tp: 2, fp: 1, tn: 1, fn: 1 })
  })

  it('returns zeros for no rows', () => {
    expect(confusionCounts({ rows: [] })).toEqual({ tp: 0, fp: 0, tn: 0, fn: 0 })
  })
})

describe('precisionRecallF1', () => {
  it('computes precision, recall, f1 and fpr', () => {
    const result = precisionRecallF1({ counts: { tp: 2, fp: 1, tn: 3, fn: 2 } })
    expect(result.precision).toBeCloseTo(2 / 3)
    expect(result.recall).toBeCloseTo(0.5)
    expect(result.f1).toBeCloseTo((2 * (2 / 3) * 0.5) / (2 / 3 + 0.5))
    expect(result.fpr).toBeCloseTo(0.25)
  })

  it('returns null rather than a perfect score on zero denominators', () => {
    expect(precisionRecallF1({ counts: { tp: 0, fp: 0, tn: 0, fn: 0 } })).toEqual({
      precision: null,
      recall: null,
      f1: null,
      fpr: null,
    })
  })

  it('has null precision when nothing is predicted positive but recall is defined', () => {
    const result = precisionRecallF1({ counts: { tp: 0, fp: 0, tn: 2, fn: 3 } })
    expect(result.precision).toBeNull()
    expect(result.recall).toBe(0)
    expect(result.f1).toBeNull()
    expect(result.fpr).toBe(0)
  })

  it('has null recall when no positives exist', () => {
    const result = precisionRecallF1({ counts: { tp: 0, fp: 2, tn: 2, fn: 0 } })
    expect(result.precision).toBe(0)
    expect(result.recall).toBeNull()
    expect(result.f1).toBeNull()
    expect(result.fpr).toBe(0.5)
  })

  it('has f1 of 0 when both precision and recall are 0', () => {
    expect(precisionRecallF1({ counts: { tp: 0, fp: 1, tn: 0, fn: 1 } }).f1).toBe(0)
  })
})

describe('exactMatchAccuracy', () => {
  it('reports the ratio with numerator and denominator', () => {
    expect(exactMatchAccuracy({ matches: 3, total: 4 })).toEqual({ value: 0.75, numerator: 3, denominator: 4 })
  })

  it('has null value for an empty total', () => {
    expect(exactMatchAccuracy({ matches: 0, total: 0 })).toEqual({ value: null, numerator: 0, denominator: 0 })
  })
})

describe('meanScore', () => {
  it('averages values', () => {
    expect(meanScore({ values: [1, 0, 1, 1] })).toBe(0.75)
  })

  it('is null for no values', () => {
    expect(meanScore({ values: [] })).toBeNull()
  })
})

describe('timingStats', () => {
  it('uses nearest-rank percentiles over sorted samples', () => {
    const samples = Array.from({ length: 20 }, (_, index) => (index + 1) * 10).reverse()
    expect(timingStats({ samples })).toEqual({ p50: 100, p95: 190, samples: 20 })
  })

  it('returns the single sample for both percentiles', () => {
    expect(timingStats({ samples: [42] })).toEqual({ p50: 42, p95: 42, samples: 1 })
  })

  it('does not mutate its input', () => {
    const samples = [3, 1, 2]
    timingStats({ samples })
    expect(samples).toEqual([3, 1, 2])
  })

  it('is null with zero samples when empty', () => {
    expect(timingStats({ samples: [] })).toEqual({ p50: null, p95: null, samples: 0 })
  })
})

describe('repeatFlipCount', () => {
  it('counts only cases with at least two trials and mixed outcomes', () => {
    const rowsByCase = new Map([
      ['stable-pass', [{ trialId: 't1', passed: true }, { trialId: 't2', passed: true }]],
      ['stable-fail', [{ trialId: 't1', passed: false }, { trialId: 't2', passed: false }]],
      ['flips', [{ trialId: 't1', passed: true }, { trialId: 't2', passed: false }, { trialId: 't3', passed: true }]],
      ['single', [{ trialId: 't1', passed: true }]],
    ])
    expect(repeatFlipCount({ rowsByCase })).toBe(1)
  })

  it('is zero for an empty map', () => {
    expect(repeatFlipCount({ rowsByCase: new Map() })).toBe(0)
  })
})
