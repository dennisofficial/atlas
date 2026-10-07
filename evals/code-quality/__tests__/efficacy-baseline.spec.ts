import { describe, expect, test } from 'bun:test'
import { EQualityImpact } from '@dltech/atlas-core'

import { ECaseReviewState } from '../../src/case'
import { inputHashOf } from '../efficacy-judgment'
import { ESrpExpectationKind } from '../expected'
import { makeCase } from './efficacy-fixtures'
import { zeroRBaselineOf } from '../efficacy-zero-r'

const negative = makeCase({ id: 'n', expected: { kind: ESrpExpectationKind.Decided, fields: { impact: EQualityImpact.Unchanged, currentConcern: false, evidenceIds: [] } } })
const secondNegative = makeCase({ id: 'n2', expected: { kind: ESrpExpectationKind.Decided, fields: { impact: EQualityImpact.Unchanged, currentConcern: false, evidenceIds: [] } } })
const positive = makeCase({ id: 'p', expected: { kind: ESrpExpectationKind.Decided, fields: { impact: EQualityImpact.Introduced, currentConcern: true, evidenceIds: ['m1'] } } })
const abstain = { ...makeCase({ id: 'a', expected: { kind: ESrpExpectationKind.Abstain } }), review: { state: ECaseReviewState.Accepted, verifications: [] } }

describe('zeroRBaselineOf', () => {
  test('predicts the frozen training-mode answer without using live outputs', () => {
    const baseline = zeroRBaselineOf({ cases: [negative, secondNegative, positive], judgments: [
      { caseId: negative.id, inputHash: inputHashOf({ input: negative.input }), notificationWarranted: false, rationale: 'negative', reviewer: 'r' },
      { caseId: secondNegative.id, inputHash: inputHashOf({ input: secondNegative.input }), notificationWarranted: false, rationale: 'negative', reviewer: 'r' },
      { caseId: positive.id, inputHash: inputHashOf({ input: positive.input }), notificationWarranted: true, rationale: 'positive', reviewer: 'r' },
    ] })
    expect(baseline).toEqual({ impact: EQualityImpact.Unchanged, currentConcern: false, evidenceIds: [], notificationWarranted: false })
  })

  test('does not derive evidence from outputs and exposes a null mode on a tied class split', () => {
    const baseline = zeroRBaselineOf({ cases: [negative, positive], judgments: [] })
    expect(baseline.notificationWarranted).toBeNull()
    expect(baseline.evidenceIds).toEqual([])
  })

  test('declares a no-decision baseline when all cases abstain', () => {
    expect(zeroRBaselineOf({ cases: [abstain], judgments: [] }).impact).toBeNull()
  })
})
