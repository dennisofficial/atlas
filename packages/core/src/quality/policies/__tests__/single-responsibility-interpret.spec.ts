import { describe, expect, it } from 'bun:test'

import type { DecisionAnswer } from '../../../ports/decision.port'
import { EQualityImpact, EQualityReviewStatus, EQualityTransition } from '../../policy'
import { scopeFixture } from '../../__tests__/fixtures'
import {
  CONCERN_INTRODUCE_THRESHOLD,
  CONCERN_RESOLVE_THRESHOLD,
  FOCUS_CONFIDENCE_THRESHOLD,
  IMPACT_CONFIDENCE_THRESHOLD,
  singleResponsibilityPolicy,
} from '../single-responsibility'

const scope = scopeFixture({
  evidence: [
    { id: 'ev-1', label: 'render()', changed: true },
    { id: 'ev-2', label: 'save()', changed: true },
  ],
})

type Plain = { concern: number; impact: EQualityImpact | string; impactP?: number; focus?: string; focusP?: number }

function answersOf({ concern, impact, impactP = 1, focus = 'ev-1', focusP = 1 }: Plain): Record<string, DecisionAnswer> {
  return {
    currentConcern: { noul: concern },
    impact: { choice: impact, probabilities: { [impact]: impactP } },
    focus: { choice: focus, probabilities: { [focus]: focusP } },
  }
}

const run = (plain: Plain) => singleResponsibilityPolicy.interpret({ scope, answers: answersOf(plain) })
const transitionOf = (plain: Plain): EQualityTransition => run(plain).transition

const { Introduced, Worsened, Improved, Resolved, Unchanged, NotApplicable, Uncertain } = EQualityImpact
const { None, Introduce, TrackDebt, Resolve } = EQualityTransition

describe('single responsibility thresholds', () => {
  it('pins the provisional constants', () => {
    expect([CONCERN_INTRODUCE_THRESHOLD, IMPACT_CONFIDENCE_THRESHOLD, FOCUS_CONFIDENCE_THRESHOLD, CONCERN_RESOLVE_THRESHOLD]).toEqual([
      0.8, 0.8, 0.8, 0.2,
    ])
  })

  it('introduces when concern, impact and focus are all confident', () => {
    const assessment = run({ concern: 0.9, impact: Introduced, impactP: 0.9, focusP: 0.9 })
    expect(assessment.status).toBe(EQualityReviewStatus.Completed)
    expect(assessment.transition).toBe(Introduce)
    expect(assessment.evidenceIds).toEqual(['ev-1'])
    expect(assessment.currentConcernProbability).toBe(0.9)
  })

  it('treats worsened like introduced', () => {
    expect(transitionOf({ concern: 0.85, impact: Worsened, focus: 'ev-2' })).toBe(Introduce)
  })

  it('concern 0.79 does not introduce but 0.8 does', () => {
    expect(transitionOf({ concern: 0.79, impact: Introduced })).toBe(None)
    expect(transitionOf({ concern: 0.8, impact: Introduced })).toBe(Introduce)
  })

  it('impact probability 0.79 only tracks debt but 0.8 introduces', () => {
    expect(transitionOf({ concern: 0.9, impact: Introduced, impactP: 0.79 })).toBe(TrackDebt)
    expect(transitionOf({ concern: 0.9, impact: Introduced, impactP: 0.8 })).toBe(Introduce)
  })

  it('focus probability 0.79 introduces without evidence, but 0.8 attaches it', () => {
    const weak = run({ concern: 0.9, impact: Introduced, focusP: 0.79 })
    expect(weak.transition).toBe(Introduce)
    expect(weak.evidenceIds).toEqual([])
    const strong = run({ concern: 0.9, impact: Introduced, focusP: 0.8 })
    expect(strong.transition).toBe(Introduce)
    expect(strong.evidenceIds).toEqual(['ev-1'])
  })

  it('recognizes none and uncertain focus and introduces without evidence', () => {
    const noneAssessment = run({ concern: 0.9, impact: Introduced, focus: 'none' })
    expect(noneAssessment.transition).toBe(Introduce)
    expect(noneAssessment.evidenceIds).toEqual([])
    const uncertainAssessment = run({ concern: 0.9, impact: Introduced, focus: 'uncertain' })
    expect(uncertainAssessment.transition).toBe(Introduce)
    expect(uncertainAssessment.evidenceIds).toEqual([])
  })

  it('accepts every supplied candidate id as focus', () => {
    for (const id of ['ev-1', 'ev-2']) {
      expect(run({ concern: 0.9, impact: Introduced, focus: id }).evidenceIds).toEqual([id])
    }
  })

  it('tracks debt for existing bad scope with unchanged or improved impact, and never introduces', () => {
    expect(transitionOf({ concern: 0.95, impact: Unchanged, impactP: 0.95 })).toBe(TrackDebt)
    expect(transitionOf({ concern: 0.9, impact: Improved, impactP: 0.9 })).toBe(TrackDebt)
    expect(transitionOf({ concern: 0.9, impact: NotApplicable })).toBe(TrackDebt)
  })

  it('resolves only at concern <= 0.2 with confident resolved, improved or unchanged impact', () => {
    expect(transitionOf({ concern: 0.2, impact: Resolved })).toBe(Resolve)
    expect(transitionOf({ concern: 0.21, impact: Resolved })).toBe(None)
    expect(transitionOf({ concern: 0.1, impact: Improved })).toBe(Resolve)
    expect(transitionOf({ concern: 0.1, impact: Unchanged, impactP: 0.8 })).toBe(Resolve)
    expect(transitionOf({ concern: 0.1, impact: Resolved, impactP: 0.7 })).toBe(None)
    expect(transitionOf({ concern: 0.1, impact: NotApplicable })).toBe(None)
  })

  it('never resolves or introduces between the bands', () => {
    for (const concern of [0.21, 0.5, 0.79]) {
      for (const impact of [Introduced, Resolved, Unchanged]) expect(transitionOf({ concern, impact })).toBe(None)
    }
  })

  it('does not flip transitions while concern oscillates around 0.8', () => {
    const transitions = [0.79, 0.8, 0.79, 0.8, 0.79].map((concern) => transitionOf({ concern, impact: Introduced }))
    expect(transitions).toEqual([None, Introduce, None, Introduce, None])
    expect(transitions.includes(Resolve)).toBe(false)
  })

  it('does not resolve while concern oscillates just above 0.2, and never introduces there', () => {
    const transitions = [0.2, 0.21, 0.2, 0.21].map((concern) => transitionOf({ concern, impact: Unchanged }))
    expect(transitions).toEqual([Resolve, None, Resolve, None])
    expect(transitions.includes(Introduce)).toBe(false)
  })

  it('resolves an externally fixed concern through unchanged, then introduces again on reintroduction', () => {
    expect(transitionOf({ concern: 0.1, impact: Unchanged, impactP: 0.9 })).toBe(Resolve)
    expect(transitionOf({ concern: 0.9, impact: Introduced, impactP: 0.9, focusP: 0.9 })).toBe(Introduce)
  })

  it('lets raw model confidence participate when probabilities are absent', () => {
    const answers = {
      currentConcern: { noul: 0.9 },
      impact: { choice: Introduced, confidence: 0.79 },
      focus: { choice: 'ev-1', confidence: 0.9 },
    }
    expect(singleResponsibilityPolicy.interpret({ scope, answers }).transition).toBe(TrackDebt)
    expect(
      singleResponsibilityPolicy.interpret({ scope, answers: { ...answers, impact: { choice: Introduced, confidence: 0.9 } } })
        .transition,
    ).toBe(Introduce)
  })

  it('never treats a bare choice as fully certain', () => {
    const bare = {
      currentConcern: { noul: 0.9 },
      impact: { choice: Introduced },
      focus: { choice: 'ev-1', probabilities: { 'ev-1': 0.9 } },
    }
    const assessment = singleResponsibilityPolicy.interpret({ scope, answers: bare })
    expect(assessment.status).toBe(EQualityReviewStatus.Inconclusive)
    expect(assessment.transition).toBe(None)
    const bareFocus = {
      ...bare,
      impact: { choice: Introduced, probabilities: { introduced: 0.9 } },
      focus: { choice: 'ev-1' },
    }
    expect(singleResponsibilityPolicy.interpret({ scope, answers: bareFocus }).status).toBe(EQualityReviewStatus.Inconclusive)
    const emptyProbabilities = {
      ...bare,
      impact: { choice: Introduced, probabilities: {} },
    }
    expect(singleResponsibilityPolicy.interpret({ scope, answers: emptyProbabilities }).status).toBe(
      EQualityReviewStatus.Inconclusive,
    )
  })

  it('reports an explicit uncertain impact as inconclusive, never as a clean review', () => {
    for (const concern of [0.1, 0.5, 0.9]) {
      const assessment = run({ concern, impact: Uncertain, impactP: 0.9 })
      expect(assessment.status).toBe(EQualityReviewStatus.Inconclusive)
      expect(assessment.transition).toBe(None)
    }
  })

  it('records every raw answer, probability and confidence', () => {
    const answers: Record<string, DecisionAnswer> = {
      currentConcern: { noul: 0.91, confidence: 0.7 },
      impact: { choice: Introduced, probabilities: { introduced: 0.9, worsened: 0.05, uncertain: 0.05 }, confidence: 0.88 },
      focus: { choice: 'ev-2', probabilities: { 'ev-2': 0.85, none: 0.1, uncertain: 0.05 } },
    }
    expect(singleResponsibilityPolicy.interpret({ scope, answers }).rawAnswers).toEqual(answers)
  })
})

describe('single responsibility inconclusive handling', () => {
  const expectInconclusive = (answers: Record<string, DecisionAnswer>, detail: string) => {
    const assessment = singleResponsibilityPolicy.interpret({ scope, answers })
    expect(assessment.status).toBe(EQualityReviewStatus.Inconclusive)
    expect(assessment.impact).toBe(Uncertain)
    expect(assessment.transition).toBe(None)
    expect(assessment.currentConcernProbability).toBeNull()
    expect(assessment.evidenceIds).toEqual([])
    expect(assessment.detail).toContain(detail)
  }

  it('never passes when an answer is missing', () => {
    const full = answersOf({ concern: 0.9, impact: Introduced })
    expectInconclusive({ impact: full.impact ?? {}, focus: full.focus ?? {} }, 'currentConcern')
    expectInconclusive({ currentConcern: full.currentConcern ?? {}, focus: full.focus ?? {} }, 'impact')
    expectInconclusive({ currentConcern: full.currentConcern ?? {}, impact: full.impact ?? {} }, 'focus')
    expectInconclusive({}, 'currentConcern')
  })

  it('rejects an unknown impact option and a focus outside the candidate set', () => {
    expectInconclusive(answersOf({ concern: 0.9, impact: 'catastrophic' }), 'impact')
    expectInconclusive(answersOf({ concern: 0.9, impact: Introduced, focus: 'ev-99' }), 'focus')
  })

  it('rejects out-of-range probabilities', () => {
    expectInconclusive({ ...answersOf({ concern: 0.9, impact: Introduced }), currentConcern: { noul: 1.5 } }, 'currentConcern')
    expectInconclusive(answersOf({ concern: 0.9, impact: Introduced, impactP: 2 }), 'impact')
  })

  it('treats a confident introduced impact with concern <= 0.2 as a contradiction, not as passing', () => {
    expectInconclusive(answersOf({ concern: 0.1, impact: Introduced, impactP: 0.9 }), 'contradicts')
  })

  it('treats a confident resolved impact with concern >= 0.8 as a contradiction', () => {
    expectInconclusive(answersOf({ concern: 0.9, impact: Resolved, impactP: 0.9 }), 'contradicts')
  })

  it('distinguishes resolved from uncertain', () => {
    const resolved = run({ concern: 0.1, impact: Resolved })
    const uncertain = run({ concern: 0.1, impact: Uncertain })
    expect(resolved.transition).toBe(Resolve)
    expect(uncertain.transition).toBe(None)
    expect(resolved.impact).toBe(Resolved)
    expect(uncertain.status).toBe(EQualityReviewStatus.Inconclusive)
  })
})
