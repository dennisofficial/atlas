import { describe, expect, test } from 'bun:test'

import { EQualityImpact } from '@dltech/atlas-core'

import { ERowStatus } from '../../src/results'
import { analyzeSrpEfficacy } from '../efficacy-report'
import { abstain, abstained, assess, decided, failedRow, judgmentFor, makeCase, rowOf } from './efficacy-fixtures'

describe('concern classification and abstention denominators', () => {
  test('0.79 concern is a positive concern prediction at threshold 0.5 and is named as such', () => {
    const evalCase = makeCase({ id: 'a', expected: decided({ impact: EQualityImpact.Introduced, concern: true, evidenceIds: ['m1'] }) })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: assess({ evalCase, concern: 0.79, impact: EQualityImpact.Introduced, focus: 'm1' }) })],
      judgments: [judgmentFor({ evalCase, warranted: null })],
    })
    expect(report.concern.threshold).toEqual({ name: 'currentConcern>=0.5', value: 0.5 })
    expect(report.concern.confusion).toEqual({ tp: 1, fp: 0, fn: 0, tn: 0 })
    expect(report.impact.onDecisions).toEqual({ numerator: 1, denominator: 1, value: 1 })
  })

  test('an unexpected abstention on a benign case is not a true negative', () => {
    const evalCase = makeCase({ id: 'b', expected: decided({ impact: EQualityImpact.Unchanged, concern: false }) })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: abstained({ evalCase }) })],
      judgments: [judgmentFor({ evalCase, warranted: null })],
    })
    expect(report.concern.confusion).toEqual({ tp: 0, fp: 0, fn: 0, tn: 0 })
    expect(report.abstention.unexpected).toEqual({ onPositive: 0, onNegative: 1 })
    expect(report.abstention.decisionCoverage).toEqual({ numerator: 0, denominator: 1, value: 0 })
    expect(report.impact.allEligible).toEqual({ numerator: 0, denominator: 1, value: 0 })
    expect(report.concern.allEligibleAccuracy).toEqual({ numerator: 0, denominator: 1, value: 0 })
  })

  test('an abstention on a concern positive is a miss in all-eligible recall, not a decided false negative', () => {
    const evalCase = makeCase({ id: 'c', expected: decided({ impact: EQualityImpact.Introduced, concern: true }) })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: abstained({ evalCase }) })],
      judgments: [judgmentFor({ evalCase, warranted: null })],
    })
    expect(report.concern.confusion.fn).toBe(0)
    expect(report.concern.missedByAbstention).toBe(1)
    expect(report.concern.allEligibleRecall).toEqual({ numerator: 0, denominator: 1, value: 0 })
    expect(report.abstention.unexpected).toEqual({ onPositive: 1, onNegative: 0 })
  })

  test('expected abstention is counted correct when the actual outcome abstains and wrong when decided', () => {
    const quiet = makeCase({ id: 'd1', expected: abstain })
    const loud = makeCase({ id: 'd2', expected: abstain })
    const report = analyzeSrpEfficacy({
      cases: [quiet, loud],
      rows: [
        rowOf({ evalCase: quiet, assessment: abstained({ evalCase: quiet }) }),
        rowOf({ evalCase: loud, assessment: assess({ evalCase: loud, concern: 0.1, impact: EQualityImpact.Unchanged }) }),
      ],
      judgments: [judgmentFor({ evalCase: quiet, warranted: null }), judgmentFor({ evalCase: loud, warranted: null })],
    })
    expect(report.abstention.expectedAbstain).toEqual({ numerator: 1, denominator: 2, value: 0.5 })
    expect(report.abstention.expectedAbstainButDecided).toBe(1)
    expect(report.abstention.actual).toEqual({ completed: 1, inconclusive: 1, skipped: 0 })
  })

  test('zero denominators are null, never zero or one', () => {
    const evalCase = makeCase({ id: 'e', expected: abstain })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: abstained({ evalCase }) })],
      judgments: [judgmentFor({ evalCase, warranted: null })],
    })
    expect(report.impact.allEligible.value).toBeNull()
    expect(report.abstention.decisionCoverage).toEqual({ numerator: 0, denominator: 0, value: null })
    expect(report.concern.precision.value).toBeNull()
  })

  test('operational failures and missing rows are separate from quality denominators', () => {
    const ok = makeCase({ id: 'f1', expected: decided({ impact: EQualityImpact.Unchanged, concern: false }) })
    const broken = makeCase({ id: 'f2', expected: decided({ impact: EQualityImpact.Unchanged, concern: false }) })
    const absent = makeCase({ id: 'f3', expected: decided({ impact: EQualityImpact.Unchanged, concern: false }) })
    const report = analyzeSrpEfficacy({
      cases: [ok, broken, absent],
      rows: [
        rowOf({ evalCase: ok, assessment: assess({ evalCase: ok, concern: 0.1, impact: EQualityImpact.Unchanged }) }),
        failedRow({ evalCase: broken, status: ERowStatus.ScorerError }),
      ],
      judgments: [ok, broken, absent].map((evalCase) => judgmentFor({ evalCase, warranted: null })),
    })
    expect(report.rows.planned).toBe(3)
    expect(report.rows.interpretable).toBe(1)
    expect(report.rows.operational).toEqual({ total: 2, byReason: { missing: 1, scorer_error: 1 } })
    expect(report.impact.allEligible).toEqual({ numerator: 1, denominator: 1, value: 1 })
    expect(report.concern.confusion.tn).toBe(1)
  })

  test('a completed row with no single-responsibility assessment is a structural failure, not a negative', () => {
    const evalCase = makeCase({ id: 'g', expected: decided({ impact: EQualityImpact.Unchanged, concern: false }) })
    const row = rowOf({ evalCase, assessment: abstained({ evalCase }) })
    const emptied = { ...row, actual: { assessments: [], resolvedModel: 'x', timing: { preparationMs: 1, inferenceMs: 1, interpretationMs: 1 } } }
    const malformed = { ...row, trialId: 'trial-2', actual: { nonsense: true } }
    const report = analyzeSrpEfficacy({ cases: [evalCase], rows: [emptied, malformed], judgments: [judgmentFor({ evalCase, warranted: null })] })
    expect(report.rows.structural.total).toBe(2)
    expect(report.rows.interpretable).toBe(0)
    expect(report.concern.confusion.tn).toBe(0)
  })
})
