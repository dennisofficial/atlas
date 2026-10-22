import { describe, expect, it } from 'bun:test'

import type { DecisionQuestion } from '../../ports/decision.port'
import { JEV_MODEL } from '../../policy/classifier/jev'
import { EQualityImpact, EQualityReviewStatus, EQualityTransition, QualityContractError } from '../policy'
import { interpretQualityResponse, JEV_QUALITY_MODEL, prepareQualityRequest } from '../request'
import { policyFixture, scopeFixture } from './fixtures'

const scope = scopeFixture()

describe('prepareQualityRequest', () => {
  it('uses the same gateway-compatible model as other Jev features', () => {
    expect(JEV_QUALITY_MODEL).toBe(JEV_MODEL)
    expect(JEV_QUALITY_MODEL).toBe('jev-latest')
  })

  it('prefixes question ids with the policy id and binds them back', () => {
    const request = prepareQualityRequest({
      scope,
      policies: [policyFixture({ id: 'srp' }), policyFixture({ id: 'other', settingKey: 'k.other' })],
    })
    expect(Object.keys(request.questions).sort()).toEqual([
      'other:concern',
      'other:focus',
      'srp:concern',
      'srp:focus',
    ])
    expect(request.bindings['srp:focus']).toEqual({ policyId: 'srp', questionKey: 'focus' })
    expect(request.policyVersions).toEqual({ srp: '1', other: '1' })
  })

  it('serializes named JSON state with scope text and policy definitions', () => {
    const state: unknown = JSON.parse(prepareQualityRequest({ scope, policies: [policyFixture()] }).state)
    expect(state).toEqual({
      scope: {
        before: scope.before,
        after: scope.after,
        diff: scope.diff,
        dependencyContext: scope.dependencyContext,
        evidence: scope.evidence,
      },
      policies: [{ id: 'srp', definition: 'a class has one responsibility', exceptions: ['data holders'] }],
    })
  })

  it('rejects a choice with more than 255 options', () => {
    const criteria = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`e${index}`, 'x']))
    const wide = policyFixture({
      questions: (): Record<string, DecisionQuestion> => ({ focus: { type: 'choice', instructions: 'i', criteria } }),
    })
    expect(() => prepareQualityRequest({ scope, policies: [wide] })).toThrow('over the 255 limit')
  })

  it('accepts a choice with exactly 255 options', () => {
    const criteria = Object.fromEntries(Array.from({ length: 255 }, (_, index) => [`e${index}`, 'x']))
    const edge = policyFixture({
      questions: (): Record<string, DecisionQuestion> => ({ focus: { type: 'choice', instructions: 'i', criteria } }),
    })
    expect(Object.keys(prepareQualityRequest({ scope, policies: [edge] }).questions)).toEqual(['srp:focus'])
  })

  it('rejects a policy listed twice and ambiguous prefixed ids', () => {
    expect(() => prepareQualityRequest({ scope, policies: [policyFixture(), policyFixture()] })).toThrow(
      QualityContractError,
    )
    const colliding = [
      policyFixture({
        id: 'a',
        questions: (): Record<string, DecisionQuestion> => ({ 'b:x': { type: 'noul', instructions: 'i' } }),
      }),
      policyFixture({
        id: 'a:b',
        questions: (): Record<string, DecisionQuestion> => ({ x: { type: 'noul', instructions: 'i' } }),
      }),
    ]
    expect(() => prepareQualityRequest({ scope, policies: colliding })).toThrow('ambiguous')
  })
})

describe('interpretQualityResponse', () => {
  const policies = [policyFixture({ id: 'srp' }), policyFixture({ id: 'other', settingKey: 'k.other' })]
  const request = prepareQualityRequest({ scope, policies })
  const good = {
    'srp:concern': { noul: 0.9 },
    'srp:focus': { choice: 'ev-1' },
    'other:concern': { noul: 0.1 },
    'other:focus': { choice: 'ev-1' },
  }

  it('maps answers back to each policy by unprefixed key', () => {
    const result = interpretQualityResponse({ request, scope, policies, answers: good })
    expect(result.map((assessment) => assessment.policyId)).toEqual(['srp', 'other'])
    expect(result[0]?.rawAnswers).toEqual({ concern: { noul: 0.9 }, focus: { choice: 'ev-1' } })
    expect(result[1]?.rawAnswers).toEqual({ concern: { noul: 0.1 }, focus: { choice: 'ev-1' } })
    expect(result.every((assessment) => assessment.status === EQualityReviewStatus.Completed)).toBe(true)
  })

  it('goes inconclusive for the policy whose answer is missing, leaving others intact', () => {
    const { 'srp:focus': _omitted, ...answers } = good
    const [srp, other] = interpretQualityResponse({ request, scope, policies, answers })
    expect(srp?.status).toBe(EQualityReviewStatus.Inconclusive)
    expect(srp?.impact).toBe(EQualityImpact.Uncertain)
    expect(srp?.transition).toBe(EQualityTransition.None)
    expect(srp?.detail).toContain('focus: no answer returned')
    expect(other?.status).toBe(EQualityReviewStatus.Completed)
  })

  it('goes inconclusive on a choice outside the offered options', () => {
    const [srp] = interpretQualityResponse({
      request,
      scope,
      policies,
      answers: { ...good, 'srp:focus': { choice: 'invented' } },
    })
    expect(srp?.status).toBe(EQualityReviewStatus.Inconclusive)
    expect(srp?.detail).toContain('not one of the offered options')
  })

  it('goes inconclusive when a choice contradicts its own probabilities', () => {
    const [srp] = interpretQualityResponse({
      request,
      scope,
      policies,
      answers: { ...good, 'srp:focus': { choice: 'ev-1', probabilities: { 'ev-1': 0.2, other: 0.7 } } },
    })
    expect(srp?.status).toBe(EQualityReviewStatus.Inconclusive)
  })

  it('goes inconclusive on out-of-range noul or confidence', () => {
    const noul = interpretQualityResponse({ request, scope, policies, answers: { ...good, 'srp:concern': { noul: 1.5 } } })
    const confidence = interpretQualityResponse({
      request,
      scope,
      policies,
      answers: { ...good, 'srp:concern': { noul: 0.5, confidence: -0.1 } },
    })
    expect(noul[0]?.status).toBe(EQualityReviewStatus.Inconclusive)
    expect(confidence[0]?.detail).toContain('confidence')
  })

  it('goes inconclusive when the policy version drifted since preparation', () => {
    const drifted = [policyFixture({ id: 'srp', version: '2' })]
    const [srp] = interpretQualityResponse({ request, scope, policies: drifted, answers: good })
    expect(srp?.status).toBe(EQualityReviewStatus.Inconclusive)
    expect(srp?.detail).toContain('version 1')
  })

  it('throws for a policy that was never part of the request', () => {
    const stranger = [policyFixture({ id: 'stranger', settingKey: 'k.s' })]
    expect(() => interpretQualityResponse({ request, scope, policies: stranger, answers: good })).toThrow(
      QualityContractError,
    )
  })
})
