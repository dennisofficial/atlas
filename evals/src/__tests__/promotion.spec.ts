import { describe, expect, it } from 'bun:test'

import { EDatasetSplit } from '../manifest'
import { promotionEligible } from '../promotion'
import { ERunMode, ERunStatus } from '../results'

const summary = { promotable: true, mode: ERunMode.Live, status: ERunStatus.Complete, operationalFailures: 0 }
const dataset = { split: EDatasetSplit.Holdout, metricGates: [{ metricId: 'accuracy', min: 0.9 }] }

describe('promotion eligibility', () => {
  it('allows a completed live held-out run with declared gates', () => {
    expect(promotionEligible({ summary, dataset })).toBe(true)
  })

  it('never promotes a fake run', () => {
    expect(promotionEligible({ summary: { ...summary, mode: ERunMode.Fake }, dataset })).toBe(false)
  })

  it('never promotes development or probe datasets', () => {
    for (const split of [EDatasetSplit.Development, EDatasetSplit.Probe]) {
      expect(promotionEligible({ summary, dataset: { ...dataset, split } })).toBe(false)
    }
  })

  it('requires metric gates declared before the run', () => {
    expect(promotionEligible({ summary, dataset: { ...dataset, metricGates: [] } })).toBe(false)
  })

  it('does not promote a failed or regressed run', () => {
    for (const status of [ERunStatus.ExecutionFailure, ERunStatus.IntegrityFailure, ERunStatus.QualityRegression]) {
      expect(promotionEligible({ summary: { ...summary, status }, dataset })).toBe(false)
    }
    expect(promotionEligible({ summary: { ...summary, operationalFailures: 1 }, dataset })).toBe(false)
  })

  it('preserves a non-default model refusal', () => {
    expect(promotionEligible({ summary: { ...summary, promotable: false }, dataset })).toBe(false)
  })
})
