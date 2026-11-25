import { describe, expect, test } from 'vitest'

import {
  formatJevRealText,
  summarizeJevReal,
  wilsonLowerBound,
  type JevRealMetricRow,
} from '../jev-real-metrics'

const row = ({
  expected,
  predicted,
  probability = 1,
  error = null,
}: {
  expected: boolean
  predicted: boolean | null
  probability?: number
  error?: string | null
}): JevRealMetricRow => ({
  error,
  inclusionProbability: probability,
  expected: { notify: expected },
  actual: predicted === null ? null : { notify: predicted },
})

describe('wilsonLowerBound', () => {
  test('matches the published 9 of 10 interval', () => {
    expect(wilsonLowerBound({ successes: 9, total: 10 })).toBeCloseTo(0.5958, 4)
  })

  test('is null without a denominator', () => {
    expect(wilsonLowerBound({ successes: 0, total: 0 })).toBeNull()
  })

  test('never leaves [0, 1] at the edges', () => {
    expect(wilsonLowerBound({ successes: 0, total: 4 })).toBe(0)
    expect(wilsonLowerBound({ successes: 4, total: 4 })).toBeLessThan(1)
  })

  test('rejects impossible counts', () => {
    expect(() => wilsonLowerBound({ successes: 5, total: 4 })).toThrow()
  })
})

describe('summarizeJevReal', () => {
  test('computes precision, its lower bound and the weighted recall', () => {
    const summary = summarizeJevReal({
      rows: [
        row({ expected: true, predicted: true, probability: 1 }),
        row({ expected: true, predicted: true, probability: 0.5 }),
        row({ expected: false, predicted: true, probability: 1 }),
        row({ expected: true, predicted: false, probability: 0.5 }),
        row({ expected: false, predicted: false, probability: 0.2 }),
      ],
    })
    expect(summary.status).toBe('complete')
    expect(summary.truePositives).toBe(2)
    expect(summary.falsePositives).toBe(1)
    expect(summary.falseNegatives).toBe(1)
    expect(summary.trueNegatives).toBe(1)
    expect(summary.precision).toBeCloseTo(2 / 3, 10)
    expect(summary.precisionLowerBound).toBeCloseTo(0.2077, 4)
    expect(summary.recallWeight).toBeCloseTo(1 + 2 + 2, 10)
    expect(summary.weightedRecall).toBeCloseTo(3 / 5, 10)
    expect(summary.weightedPrecision).toBeCloseTo(3 / 4, 10)
  })

  test('weights a false nudge on a rarely sampled item by its inclusion probability', () => {
    const summary = summarizeJevReal({
      rows: [
        row({ expected: true, predicted: true, probability: 1 }),
        row({ expected: false, predicted: true, probability: 0.05 }),
      ],
    })
    expect(summary.precision).toBeCloseTo(1 / 2, 10)
    expect(summary.weightedPrecision).toBeCloseTo(1 / 21, 10)
  })

  test('reports undefined precision when nothing was nudged, never success', () => {
    const summary = summarizeJevReal({
      rows: [row({ expected: false, predicted: false }), row({ expected: true, predicted: false })],
    })
    expect(summary.precision).toBeNull()
    expect(summary.precisionLowerBound).toBeNull()
    expect(summary.weightedRecall).toBe(0)
  })

  test('reports undefined recall when no item is labelled nudge', () => {
    const summary = summarizeJevReal({ rows: [row({ expected: false, predicted: false })] })
    expect(summary.weightedRecall).toBeNull()
    expect(summary.recallWeight).toBe(0)
  })

  test('counts an errored or unanswered item as incomplete evidence and leaves it out', () => {
    const summary = summarizeJevReal({
      rows: [
        row({ expected: true, predicted: true }),
        row({ expected: true, predicted: null, error: 'decision call failed: timeout' }),
      ],
    })
    expect(summary.status).toBe('incomplete')
    expect(summary.items).toBe(2)
    expect(summary.scored).toBe(1)
    expect(summary.errors).toBe(1)
    expect(summary.precision).toBe(1)
  })

  test('formats the summary for a terminal', () => {
    const text = formatJevRealText({
      summary: summarizeJevReal({ rows: [row({ expected: true, predicted: true })] }),
    })
    expect(text).toContain('precision: 1.000')
    expect(text).toContain('wilson95 lower:')
    expect(text).toContain('weighted recall: 1.000')
  })
})
