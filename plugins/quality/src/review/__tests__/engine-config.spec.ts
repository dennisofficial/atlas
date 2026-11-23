import { describe, expect, it } from 'bun:test'

import { EClassifierFault, EQualityReviewStatus, EQualitySkipReason } from '@dltech/atlas-core'

import { INTRODUCE, answersFor, calibrated, createRig, nudgesOf, recordsOf } from './fixtures'

describe('classifier configuration', () => {
  it('answers an uncalibrated model with an inconclusive record and no nudge', async () => {
    const rig = createRig({
      classify: async () =>
        calibrated({
          answers: answersFor({ verdicts: { srp: INTRODUCE } }),
          model: 'someone-else',
        }),
    })
    const drafts = await rig.review()
    const [record] = recordsOf(drafts)
    expect(record).toMatchObject({
      status: EQualityReviewStatus.Inconclusive,
      reason: EQualitySkipReason.UncalibratedModel,
      requestedModel: 'jev-latest',
      resolvedModel: 'someone-else',
      assessments: [],
      findings: [],
    })
    expect(nudgesOf(drafts)).toHaveLength(0)
  })

  it('records a rejected classifier as an operational error with the fault in the detail', async () => {
    const rig = createRig({
      classify: async () => ({
        ok: false,
        fault: EClassifierFault.Rejected,
        detail: 'HTTP 429',
      }),
    })
    const drafts = await rig.review()
    const [record] = recordsOf(drafts)
    expect(record).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.DecisionUnavailable,
      detail: 'rejected: HTTP 429',
    })
    expect(nudgesOf(drafts)).toHaveLength(0)
  })

  it('captures nothing and asks nothing when the quality switch is off', async () => {
    const rig = createRig({ settings: {} })
    expect(rig.engine.captureEnabled()).toBe(false)
    expect(await rig.review()).toEqual([])
    expect(rig.classifyCalls).toHaveLength(0)
  })
})
