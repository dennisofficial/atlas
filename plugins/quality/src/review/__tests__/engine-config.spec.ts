import { describe, expect, it } from 'bun:test'

import { EClassifierFault, EQualityReviewStatus, EQualitySkipReason } from '@dltech/atlas-core'

import { INTRODUCE, answersFor, calibrated, contextOf, createRig, recordsOf } from './fixtures'

describe('classifier configuration', () => {
  it('answers an uncalibrated model with an inconclusive record and no finding', async () => {
    const rig = createRig({
      classify: async () =>
        calibrated({
          answers: answersFor({ verdicts: { srp: INTRODUCE } }),
          model: 'someone-else',
        }),
    })
    const result = await rig.review()
    const [record] = recordsOf(result)
    expect(record).toMatchObject({
      status: EQualityReviewStatus.Inconclusive,
      reason: EQualitySkipReason.UncalibratedModel,
      requestedModel: 'jev-latest',
      resolvedModel: 'someone-else',
      assessments: [],
      findings: [],
    })
    expect(contextOf(result)).toBeUndefined()
  })

  it('records a rejected classifier as an operational error with the fault in the detail', async () => {
    const rig = createRig({
      classify: async () => ({
        ok: false,
        fault: EClassifierFault.Rejected,
        detail: 'HTTP 429',
      }),
    })
    const result = await rig.review()
    const [record] = recordsOf(result)
    expect(record).toMatchObject({
      status: EQualityReviewStatus.OperationalError,
      reason: EQualitySkipReason.DecisionUnavailable,
      detail: 'rejected: HTTP 429',
    })
    expect(contextOf(result)).toBeUndefined()
  })

  it('reviews nothing and asks nothing when the quality switch is off', async () => {
    const rig = createRig({ settings: {} })
    expect(await rig.review()).toEqual({ records: [], context: undefined })
    expect(rig.classifyCalls).toHaveLength(0)
  })
})
