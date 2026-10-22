import { describe, expect, it } from 'bun:test'

import { EQualityFindingState, EQualityReviewStatus, EQualitySkipReason } from '../policy'
import { codeQualityReviewedSchema } from '../schema'
import { assessmentFixture, reviewFixture, scopeFixture } from './fixtures'

const full = () =>
  reviewFixture({
    scope: scopeFixture(),
    assessments: [assessmentFixture({ rawAnswers: { concern: { noul: 0.9, confidence: 0.8 } } })],
    findings: [
      {
        id: 'srp:scope-1:1',
        policyId: 'srp',
        scopeId: 'scope-1',
        episode: 1,
        state: EQualityFindingState.Active,
        notified: true,
        lastAfterHash: 'a1',
        policyVersion: '1',
      },
    ],
    requestedModel: 'jev-1.13.0',
    resolvedModel: 'jev-1.13.0',
    evidencePath: 'quality/examples/x.json',
  })

describe('codeQualityReviewedSchema', () => {
  it('accepts a complete record', () => {
    expect(codeQualityReviewedSchema.safeParse(full()).success).toBe(true)
  })

  it('accepts fixtures without optional confidence or model fields', () => {
    const minimal = reviewFixture({
      scope: scopeFixture(),
      assessments: [assessmentFixture({ rawAnswers: { concern: { noul: 0.4 } } })],
    })
    expect(codeQualityReviewedSchema.safeParse(minimal).success).toBe(true)
  })

  it('accepts a file-level skipped record with no scope or findings', () => {
    const skipped = reviewFixture({ status: EQualityReviewStatus.Skipped, reason: EQualitySkipReason.WorkspaceUnidentified })
    expect(codeQualityReviewedSchema.safeParse(skipped).success).toBe(true)
  })

  it('rejects answer confidence outside [0, 1]', () => {
    for (const confidence of [1.01, -0.01]) {
      const bad = reviewFixture({
        assessments: [assessmentFixture({ rawAnswers: { concern: { noul: 0.5, confidence } } })],
      })
      expect(codeQualityReviewedSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('rejects a concern probability outside [0, 1]', () => {
    const bad = reviewFixture({ assessments: [assessmentFixture({ currentConcernProbability: 1.2 })] })
    expect(codeQualityReviewedSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects unknown enum members, wrong types and a bad line range', () => {
    expect(codeQualityReviewedSchema.safeParse({ ...full(), status: 'done' }).success).toBe(false)
    expect(codeQualityReviewedSchema.safeParse({ ...full(), durationMs: -1 }).success).toBe(false)
    expect(codeQualityReviewedSchema.safeParse({ ...full(), type: 'other' }).success).toBe(false)
    const reversed = reviewFixture({ scope: scopeFixture({ lineRange: { start: 9, end: 2 } }) })
    expect(codeQualityReviewedSchema.safeParse(reversed).success).toBe(false)
  })

  it('rejects a missing required field', () => {
    const { callId: _callId, ...rest } = full()
    expect(codeQualityReviewedSchema.safeParse(rest).success).toBe(false)
  })

  it('strips raw source smuggled into the scope identity', () => {
    const parsed = codeQualityReviewedSchema.parse({ ...full(), scope: scopeFixture() })
    expect(parsed.scope).not.toHaveProperty('before')
    expect(parsed.scope).not.toHaveProperty('after')
    expect(parsed.scope).not.toHaveProperty('diff')
  })
})
