import { describe, expect, test } from 'bun:test'

import { EQualityImpact, type QualityScope } from '@dltech/atlas-core'

import { ERowStatus } from '../../src/results'
import { EGateStatus } from '../efficacy-gates'
import { EfficacyInputError, inputHashOf } from '../efficacy-judgment'
import { analyzeSrpEfficacy } from '../efficacy-report'
import { assess, decided, failedRow, judgmentFor, makeCase, MODEL, rowOf } from './efficacy-fixtures'

const benign = decided({ impact: EQualityImpact.Unchanged, concern: false })
const introduced = decided({ impact: EQualityImpact.Introduced, concern: true, evidenceIds: ['m1'] })

const problemsOf = (run: () => unknown): readonly string[] => {
  try {
    run()
  } catch (fault) {
    if (fault instanceof EfficacyInputError) return fault.problems
    throw fault
  }
  return []
}

describe('repeat instability', () => {
  test('different wrong impacts across trials are unstable even though both are wrong', () => {
    const evalCase = makeCase({ id: 'r1', expected: benign })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [
        rowOf({ evalCase, trialId: 'trial-1', assessment: assess({ evalCase, concern: 0.1, impact: EQualityImpact.Improved }) }),
        rowOf({ evalCase, trialId: 'trial-2', assessment: assess({ evalCase, concern: 0.1, impact: EQualityImpact.Resolved }) }),
      ],
      judgments: [judgmentFor({ evalCase, warranted: null })],
    })
    expect(report.instability.unstableOutcomes).toEqual({ numerator: 1, denominator: 1, value: 1 })
    expect(report.instability.unstable[0]).toEqual({ caseId: 'r1', variantId: 'default', trialIds: ['trial-1', 'trial-2'], signatures: 2 })
    expect(report.independent.cases).toBe(1)
  })

  test('identical repeats are stable and a notify/no-notify flip is retained with its trials', () => {
    const stable = makeCase({ id: 'r2', expected: benign })
    const flipping = makeCase({ id: 'r3', expected: introduced })
    const report = analyzeSrpEfficacy({
      cases: [stable, flipping],
      rows: [
        rowOf({ evalCase: stable, trialId: 'trial-1', assessment: assess({ evalCase: stable, concern: 0.1, impact: EQualityImpact.Unchanged }) }),
        rowOf({ evalCase: stable, trialId: 'trial-2', assessment: assess({ evalCase: stable, concern: 0.1, impact: EQualityImpact.Unchanged }) }),
        rowOf({ evalCase: flipping, trialId: 'trial-1', assessment: assess({ evalCase: flipping, concern: 0.9, impact: EQualityImpact.Introduced, focus: 'm1' }) }),
        rowOf({ evalCase: flipping, trialId: 'trial-2', assessment: assess({ evalCase: flipping, concern: 0.79, impact: EQualityImpact.Introduced, focus: 'm1' }) }),
      ],
      judgments: [judgmentFor({ evalCase: stable, warranted: false }), judgmentFor({ evalCase: flipping, warranted: true })],
    })
    expect(report.instability.unstableOutcomes).toEqual({ numerator: 1, denominator: 2, value: 0.5 })
    expect(report.instability.notificationFlips).toEqual([{ caseId: 'r3', variantId: 'default', trialIds: ['trial-1', 'trial-2'], notified: 1, trials: 2 }])
    expect(report.notification.byCase).toEqual([{ caseId: 'r3', notified: 1, trials: 2, frequency: { numerator: 1, denominator: 2, value: 0.5 } }])
    expect(report.checks.find((entry) => entry.id === 'zero-notification-flips')?.status).toBe(EGateStatus.Fail)
  })

  test('variants of one case are isolated groups and operational variability is separate', () => {
    const evalCase = makeCase({ id: 'r4', expected: benign })
    const quiet = assess({ evalCase, concern: 0.1, impact: EQualityImpact.Unchanged })
    const loud = assess({ evalCase, concern: 0.1, impact: EQualityImpact.Improved })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [
        rowOf({ evalCase, trialId: 'trial-1', variantId: 'a', assessment: quiet }),
        rowOf({ evalCase, trialId: 'trial-1', variantId: 'b', assessment: loud }),
        rowOf({ evalCase, trialId: 'trial-2', variantId: 'a', assessment: quiet }),
        { ...failedRow({ evalCase, trialId: 'trial-2' }), variantId: 'b' },
      ],
      judgments: [judgmentFor({ evalCase, warranted: null })],
    })
    expect(report.instability.unstable).toEqual([])
    expect(report.instability.operationalVariable).toEqual([{ caseId: 'r4', variantId: 'b', trialIds: ['trial-1', 'trial-2'] }])
    expect(report.rows.operational.total).toBe(1)
    expect(report.independent.cases).toBe(1)
  })
})

describe('row identity validation', () => {
  const evalCase = makeCase({ id: 'v1', expected: benign })
  const quiet = assess({ evalCase, concern: 0.1, impact: EQualityImpact.Unchanged })
  const judgments = [judgmentFor({ evalCase, warranted: null })]

  test('duplicate row identities are rejected, not averaged', () => {
    const rows = [rowOf({ evalCase, assessment: quiet }), rowOf({ evalCase, assessment: quiet })]
    expect(problemsOf(() => analyzeSrpEfficacy({ cases: [evalCase], rows, judgments }))).toEqual(['duplicate row v1/trial-1/default'])
  })

  test('rows outside the declared plan or for unknown cases are rejected and planned rows without results are missing', () => {
    const plan = [{ caseId: 'v1', trialId: 'trial-1', variantId: 'default' }, { caseId: 'v1', trialId: 'trial-2', variantId: 'default' }]
    const stray = { ...rowOf({ evalCase, assessment: quiet }), trialId: 'trial-9' }
    expect(problemsOf(() => analyzeSrpEfficacy({ cases: [evalCase], rows: [stray], judgments, plan }))).toEqual(['row v1/trial-9/default is not in the planned rows'])
    const unknown = { ...rowOf({ evalCase, assessment: quiet }), caseId: 'ghost' }
    expect(problemsOf(() => analyzeSrpEfficacy({ cases: [evalCase], rows: [unknown], judgments, plan }))).toContain('row for unknown case "ghost"')
    const report = analyzeSrpEfficacy({ cases: [evalCase], rows: [rowOf({ evalCase, assessment: quiet })], judgments, plan })
    expect(report.rows.operational.byReason).toEqual({ missing: 1 })
  })

  test('a resolved model different from the requested one is an operational identity failure', () => {
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: quiet, model: 'other-model' })],
      judgments,
      requestedModel: MODEL,
    })
    expect(report.rows.operational.byReason).toEqual({ model_identity: 1 })
    expect(report.rows.interpretable).toBe(0)
  })

  test('task errors never become quality outcomes', () => {
    const report = analyzeSrpEfficacy({ cases: [evalCase], rows: [failedRow({ evalCase, status: ERowStatus.TaskError })], judgments })
    expect(report.rows.operational).toEqual({ total: 1, byReason: { task_error: 1 } })
    expect(report.concern.confusion).toEqual({ tp: 0, fp: 0, fn: 0, tn: 0 })
  })
})

describe('output binding', () => {
  test('a scope or label mismatch is structural, not silently credited to the case', () => {
    const evalCase = makeCase({ id: 'o1', expected: benign })
    const other = makeCase({ id: 'other', expected: benign, evidenceIds: ['other'] })
    const judgments = [judgmentFor({ evalCase, warranted: null })]
    const wrongScope = { ...assess({ evalCase, concern: 0.1, impact: EQualityImpact.Unchanged }), scopeId: (other.input as { scope: QualityScope }).scope.id }
    const report = analyzeSrpEfficacy({ cases: [evalCase], rows: [rowOf({ evalCase, assessment: wrongScope })], judgments })
    expect(report.rows.structural.byReason).toEqual({ scope_mismatch: 1 })

    const duplicate = { assessments: [assess({ evalCase, concern: 0.1, impact: EQualityImpact.Unchanged }), assess({ evalCase, concern: 0.1, impact: EQualityImpact.Unchanged })], resolvedModel: MODEL, timing: { preparationMs: 0, inferenceMs: 0, interpretationMs: 0, endToEndMs: 0 } }
    const duplicates = analyzeSrpEfficacy({ cases: [evalCase], rows: [{ ...rowOf({ evalCase, assessment: assess({ evalCase, concern: 0.1, impact: EQualityImpact.Unchanged }) }), actual: duplicate }], judgments })
    expect(duplicates.rows.structural.byReason).toEqual({ duplicate_assessment: 1 })

    const expectedMismatch = { ...rowOf({ evalCase, assessment: assess({ evalCase, concern: 0.1, impact: EQualityImpact.Unchanged }) }), expected: introduced }
    const relabelled = analyzeSrpEfficacy({ cases: [evalCase], rows: [expectedMismatch], judgments })
    expect(relabelled.rows.structural.byReason).toEqual({ expected_mismatch: 1 })
  })
})

describe('judgment validation', () => {
  const evalCase = makeCase({ id: 'j1', expected: introduced })
  const rows = [rowOf({ evalCase, assessment: assess({ evalCase, concern: 0.9, impact: EQualityImpact.Introduced, focus: 'm1' }) })]

  test('a judgment bound to a different input hash is rejected', () => {
    const stale = { ...judgmentFor({ evalCase, warranted: true }), inputHash: inputHashOf({ input: 'other' }) }
    expect(problemsOf(() => analyzeSrpEfficacy({ cases: [evalCase], rows, judgments: [stale] }))).toEqual(['judgment for case "j1" is bound to a different input hash'])
  })

  test('missing, unknown and duplicate judgments are rejected', () => {
    const good = judgmentFor({ evalCase, warranted: true })
    expect(problemsOf(() => analyzeSrpEfficacy({ cases: [evalCase], rows, judgments: [] }))).toEqual(['case "j1" has no judgment'])
    expect(problemsOf(() => analyzeSrpEfficacy({ cases: [evalCase], rows, judgments: [good, { ...good, caseId: 'ghost' }] }))).toEqual(['judgment for unknown case "ghost"'])
    expect(problemsOf(() => analyzeSrpEfficacy({ cases: [evalCase], rows, judgments: [good, good] }))).toEqual(['duplicate judgment for case "j1"'])
  })

  test('expected evidence must be unique and present in the input', () => {
    const bad = makeCase({ id: 'j2', expected: decided({ impact: EQualityImpact.Introduced, concern: true, evidenceIds: ['m1', 'm1', 'zzz'] }) })
    const problems = problemsOf(() => analyzeSrpEfficacy({ cases: [bad], rows: [], judgments: [judgmentFor({ evalCase: bad, warranted: true })] }))
    expect(problems).toEqual([
      'case "j2" expected evidence ids are not unique',
      'case "j2" expected evidence "zzz" is not in the input evidence',
    ])
  })
})
