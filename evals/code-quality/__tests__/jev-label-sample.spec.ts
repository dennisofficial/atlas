import { describe, expect, test } from 'vitest'

import {
  EJevLabelStratum,
  JevLabelSampleError,
  inclusionProbabilityOf,
  selectJevLabelSample,
  stratumOf,
  type JevLabelFrameRow,
} from '../jev-label-sample'

const rowOf = ({
  traceId,
  scopeId,
  verdict,
}: {
  traceId: string
  scopeId: string
  verdict: string
}): JevLabelFrameRow => ({
  generationId: `gen-${scopeId}`,
  traceId,
  scopeId,
  policyId: 'single-responsibility',
  path: `src/${scopeId}.ts`,
  verdict,
  impact: verdict === 'nudged' ? 'introduced' : 'unchanged',
  timestamp: '2026-11-27T12:00:00.000Z',
})

describe('stratumOf', () => {
  test('maps the verdicts to the three strata', () => {
    expect(stratumOf({ verdict: 'nudged' })).toBe(EJevLabelStratum.Nudged)
    expect(stratumOf({ verdict: 'debt_nudged' })).toBe(EJevLabelStratum.Nudged)
    expect(stratumOf({ verdict: 'near_miss' })).toBe(EJevLabelStratum.NearMiss)
    expect(stratumOf({ verdict: 'tracked_debt' })).toBe(EJevLabelStratum.NearMiss)
    expect(stratumOf({ verdict: 'clean' })).toBe(EJevLabelStratum.Random)
  })
})

describe('inclusionProbabilityOf', () => {
  test('divides the sampling rate by the scopes the trace holds in the stratum', () => {
    expect(inclusionProbabilityOf({ requested: 2, available: 5, traceScopeCount: 1 })).toBe(0.4)
    expect(inclusionProbabilityOf({ requested: 2, available: 5, traceScopeCount: 2 })).toBe(0.2)
  })

  test('caps a fully sampled stratum at one shared by its scopes', () => {
    expect(inclusionProbabilityOf({ requested: 9, available: 4, traceScopeCount: 3 })).toBe(
      0.333333,
    )
  })

  test('refuses an empty stratum', () => {
    expect(() =>
      inclusionProbabilityOf({ requested: 1, available: 0, traceScopeCount: 1 }),
    ).toThrow(JevLabelSampleError)
  })
})

describe('selectJevLabelSample', () => {
  const frame = (): readonly JevLabelFrameRow[] => [
    rowOf({ traceId: 'trace-nudge', scopeId: 'nudge-a', verdict: 'nudged' }),
    rowOf({ traceId: 'trace-nudge', scopeId: 'nudge-b', verdict: 'nudged' }),
    rowOf({ traceId: 'trace-near-1', scopeId: 'near-1', verdict: 'near_miss' }),
    rowOf({ traceId: 'trace-near-2', scopeId: 'near-2', verdict: 'near_miss' }),
    rowOf({ traceId: 'trace-near-3', scopeId: 'near-3', verdict: 'tracked_debt' }),
    rowOf({ traceId: 'trace-clean-1', scopeId: 'clean-1', verdict: 'clean' }),
    rowOf({ traceId: 'trace-clean-2', scopeId: 'clean-2', verdict: 'clean' }),
    rowOf({ traceId: 'trace-clean-3', scopeId: 'clean-3', verdict: 'clean' }),
  ]

  test('takes every nudged trace, then the near-miss and random budgets', () => {
    const sample = selectJevLabelSample({ rows: frame(), nearMiss: 2, random: 2 })
    const strata = sample.map((entry) => entry.stratum)
    expect(strata.filter((stratum) => stratum === EJevLabelStratum.Nudged)).toHaveLength(1)
    expect(strata.filter((stratum) => stratum === EJevLabelStratum.NearMiss)).toHaveLength(2)
    expect(strata.filter((stratum) => stratum === EJevLabelStratum.Random)).toHaveLength(2)
  })

  test('takes one item per trace, from the highest stratum the trace reaches', () => {
    const sample = selectJevLabelSample({
      rows: [
        rowOf({ traceId: 'trace-mixed', scopeId: 'mixed-nudge', verdict: 'nudged' }),
        rowOf({ traceId: 'trace-mixed', scopeId: 'mixed-clean', verdict: 'clean' }),
      ],
      nearMiss: 2,
      random: 2,
    })
    expect(sample).toHaveLength(1)
    expect(sample[0]?.stratum).toBe(EJevLabelStratum.Nudged)
  })

  test('weights a scope by the scopes its trace holds in the stratum', () => {
    const sample = selectJevLabelSample({ rows: frame(), nearMiss: 2, random: 2 })
    const nudge = sample.find((entry) => entry.stratum === EJevLabelStratum.Nudged)
    const nearMiss = sample.find((entry) => entry.stratum === EJevLabelStratum.NearMiss)
    expect(nudge?.inclusionProbability).toBe(0.5)
    expect(nearMiss?.inclusionProbability).toBe(0.666667)
  })

  test('picks the budget deterministically for one seed and differs for another', () => {
    const first = selectJevLabelSample({ rows: frame(), nearMiss: 1, random: 1, seed: 'a' })
    const again = selectJevLabelSample({ rows: frame(), nearMiss: 1, random: 1, seed: 'a' })
    expect(first.map((entry) => entry.row.scopeId)).toEqual(again.map((entry) => entry.row.scopeId))
    const other = selectJevLabelSample({ rows: frame(), nearMiss: 1, random: 1, seed: 'b' })
    expect(other.map((entry) => entry.row.scopeId)).toHaveLength(3)
  })

  test('samples nothing from an empty frame', () => {
    expect(selectJevLabelSample({ rows: [], nearMiss: 2, random: 2 })).toEqual([])
  })
})
