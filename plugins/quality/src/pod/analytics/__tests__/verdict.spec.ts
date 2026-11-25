import { describe, expect, it } from 'bun:test'

import {
  EQualityImpact,
  EQualityReviewStatus,
  EQualityTransition,
  type QualityAssessment,
} from '@dltech/atlas-core'

import { EQualityVerdict, nearMissOf, strongerVerdictOf, verdictOf } from '../verdict'

const assessment = (overrides: Partial<QualityAssessment> = {}): QualityAssessment => ({
  policyId: 'single-responsibility',
  policyVersion: '1',
  scopeId: 'scope-1',
  status: EQualityReviewStatus.Completed,
  impact: EQualityImpact.Introduced,
  currentConcernProbability: 0.9,
  transition: EQualityTransition.Introduce,
  evidenceIds: [],
  rawAnswers: {},
  ...overrides,
})

describe('verdictOf', () => {
  it('nudges an introduced finding that was notified in this run', () => {
    expect(verdictOf({ assessment: assessment(), notified: true })).toBe(EQualityVerdict.Nudged)
  })

  it('repeats an introduction that was already notified before', () => {
    expect(verdictOf({ assessment: assessment(), notified: false })).toBe(EQualityVerdict.Repeat)
  })

  it('names tracked debt', () => {
    const held = assessment({ transition: EQualityTransition.TrackDebt })

    expect(verdictOf({ assessment: held, notified: false })).toBe(EQualityVerdict.TrackedDebt)
  })

  it('calls a resolved scope clean', () => {
    const held = assessment({
      transition: EQualityTransition.Resolve,
      currentConcernProbability: 0.1,
    })

    expect(verdictOf({ assessment: held, notified: false })).toBe(EQualityVerdict.Clean)
  })

  it('calls a scope with no transition and a high concern a near miss', () => {
    const held = assessment({
      transition: EQualityTransition.None,
      currentConcernProbability: 0.5,
    })

    expect(verdictOf({ assessment: held, notified: false })).toBe(EQualityVerdict.NearMiss)
  })

  it('calls a scope with no transition and a low concern clean', () => {
    const held = assessment({
      transition: EQualityTransition.None,
      currentConcernProbability: 0.49,
    })

    expect(verdictOf({ assessment: held, notified: false })).toBe(EQualityVerdict.Clean)
  })

  it('calls an assessment that did not complete inconclusive', () => {
    const held = assessment({
      status: EQualityReviewStatus.Inconclusive,
      currentConcernProbability: null,
    })

    expect(verdictOf({ assessment: held, notified: false })).toBe(EQualityVerdict.Inconclusive)
  })
})

describe('nearMissOf', () => {
  it('counts a tracked debt', () => {
    expect(nearMissOf({ verdict: EQualityVerdict.TrackedDebt, concern: null })).toBe(true)
  })

  it('counts a high concern that was not nudged', () => {
    expect(nearMissOf({ verdict: EQualityVerdict.Repeat, concern: 0.6 })).toBe(true)
  })

  it('never counts a nudge', () => {
    expect(nearMissOf({ verdict: EQualityVerdict.Nudged, concern: 0.95 })).toBe(false)
  })

  it('leaves a clean scope out', () => {
    expect(nearMissOf({ verdict: EQualityVerdict.Clean, concern: 0.3 })).toBe(false)
  })
})

describe('strongerVerdictOf', () => {
  it('keeps the strongest verdict of a policy', () => {
    expect(strongerVerdictOf({ left: EQualityVerdict.Nudged, right: EQualityVerdict.Clean })).toBe(
      EQualityVerdict.Nudged,
    )
    expect(
      strongerVerdictOf({ left: EQualityVerdict.Clean, right: EQualityVerdict.NearMiss }),
    ).toBe(EQualityVerdict.NearMiss)
  })
})
