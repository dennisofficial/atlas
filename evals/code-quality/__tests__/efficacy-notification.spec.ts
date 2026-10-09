import { describe, expect, test } from 'bun:test'

import { EQualityImpact, EQualityScopeKind } from '@dltech/atlas-core'

import { EDiagnosticStatus, EGateStatus } from '../efficacy-gates'
import { analyzeSrpEfficacy } from '../efficacy-report'
import { abstained, assess, decided, judgmentFor, makeCase, rowOf } from './efficacy-fixtures'

const introduced = decided({ impact: EQualityImpact.Introduced, concern: true, evidenceIds: ['m1'] })

describe('fresh-episode notification measurement through the real ledger', () => {
  test('an introduced finding with supplied focus notifies and matches a warranted judgment', () => {
    const evalCase = makeCase({ id: 'n1', expected: introduced })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: assess({ evalCase, concern: 0.85, impact: EQualityImpact.Introduced, focus: 'm1' }) })],
      judgments: [judgmentFor({ evalCase, warranted: true })],
    })
    expect(report.notification.confusion).toEqual({ tp: 1, fp: 0, fn: 0, tn: 0 })
    expect(report.notification.precision).toEqual({ numerator: 1, denominator: 1, value: 1 })
    expect(report.evidence.wrongEvidenceNotifications).toEqual({ numerator: 0, denominator: 1, value: 0 })
    expect(report.notification.byCase).toEqual([{ caseId: 'n1', notified: 1, trials: 1, frequency: { numerator: 1, denominator: 1, value: 1 } }])
  })

  test('0.79 concern is a concern-positive but silent, so a warranted notification is a miss', () => {
    const evalCase = makeCase({ id: 'n2', expected: introduced })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: assess({ evalCase, concern: 0.79, impact: EQualityImpact.Introduced, focus: 'm1' }) })],
      judgments: [judgmentFor({ evalCase, warranted: true })],
    })
    expect(report.concern.confusion.tp).toBe(1)
    expect(report.notification.actualNotifications).toBe(0)
    expect(report.notification.confusion).toEqual({ tp: 0, fp: 0, fn: 1, tn: 0 })
    expect(report.notification.precision.value).toBeNull()
  })

  test('unchanged high-concern debt is silent and a true negative for notification', () => {
    const evalCase = makeCase({ id: 'n3', expected: decided({ impact: EQualityImpact.Unchanged, concern: true }) })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: assess({ evalCase, concern: 0.95, impact: EQualityImpact.Unchanged }) })],
      judgments: [judgmentFor({ evalCase, warranted: false })],
    })
    expect(report.notification.confusion).toEqual({ tp: 0, fp: 0, fn: 0, tn: 1 })
    expect(report.notification.actualNotifications).toBe(0)
  })

  test('a function positive without supplied focus is a true positive, not a coverage limitation', () => {
    const evalCase = makeCase({ id: 'n4', kind: EQualityScopeKind.Function, evidenceIds: [], expected: decided({ impact: EQualityImpact.Introduced, concern: true }) })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: assess({ evalCase, concern: 0.95, impact: EQualityImpact.Introduced }) })],
      judgments: [judgmentFor({ evalCase, warranted: true })],
    })
    expect(report.notification.confusion.tp).toBe(1)
    expect(report.notification.coverageLimitedCaseIds).toEqual(['n4'])
    expect(report.strata.byScopeKind.function?.independentCases).toBe(1)
  })

  test('an abstention on a warranted case is a miss and an abstention on an unwarranted case is not a true negative', () => {
    const warranted = makeCase({ id: 'n5a', expected: introduced })
    const benign = makeCase({ id: 'n5b', expected: decided({ impact: EQualityImpact.Unchanged, concern: false }) })
    const report = analyzeSrpEfficacy({
      cases: [warranted, benign],
      rows: [rowOf({ evalCase: warranted, assessment: abstained({ evalCase: warranted }) }), rowOf({ evalCase: benign, assessment: abstained({ evalCase: benign }) })],
      judgments: [judgmentFor({ evalCase: warranted, warranted: true }), judgmentFor({ evalCase: benign, warranted: false })],
    })
    expect(report.notification.confusion).toEqual({ tp: 0, fp: 0, fn: 1, tn: 0 })
    expect(report.notification.missedByAbstention).toBe(1)
    expect(report.notification.abstainedOnUnwarranted).toBe(1)
    expect(report.notification.recall).toEqual({ numerator: 0, denominator: 1, value: 0 })
  })

  test('a notification with the wrong supplied evidence is flagged and blocks the diagnostic', () => {
    const evalCase = makeCase({ id: 'n6', expected: introduced })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: assess({ evalCase, concern: 0.9, impact: EQualityImpact.Introduced, focus: 'm2' }) })],
      judgments: [judgmentFor({ evalCase, warranted: true })],
    })
    expect(report.evidence.wrongEvidenceNotifications).toEqual({ numerator: 1, denominator: 1, value: 1 })
    expect(report.evidence.exactTuple.expectedNonEmpty).toEqual({ numerator: 0, denominator: 1, value: 0 })
    const check = report.checks.find((entry) => entry.id === 'no-wrongly-grounded-notification')
    expect(check?.status).toBe(EGateStatus.Fail)
    expect(report.diagnosticStatus).toBe(EDiagnosticStatus.Blocked)
  })

  test('an unjustified notification fails its check', () => {
    const evalCase = makeCase({ id: 'n7', expected: introduced })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: assess({ evalCase, concern: 0.9, impact: EQualityImpact.Introduced, focus: 'm1' }) })],
      judgments: [judgmentFor({ evalCase, warranted: false })],
    })
    expect(report.notification.confusion.fp).toBe(1)
    expect(report.checks.find((entry) => entry.id === 'no-unjustified-notification')?.status).toBe(EGateStatus.Fail)
  })

  test('with no actual notifications precision and the notification checks are insufficient evidence, never a pass', () => {
    const evalCase = makeCase({ id: 'n8', expected: decided({ impact: EQualityImpact.Unchanged, concern: false }) })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: assess({ evalCase, concern: 0.1, impact: EQualityImpact.Unchanged }) })],
      judgments: [judgmentFor({ evalCase, warranted: false })],
    })
    const statuses = Object.fromEntries(report.checks.map((entry) => [entry.id, entry.status]))
    expect(statuses['notification-precision']).toBe(EGateStatus.InsufficientEvidence)
    expect(statuses['notification-recall']).toBe(EGateStatus.InsufficientEvidence)
    expect(report.diagnosticStatus).toBe(EDiagnosticStatus.InsufficientEvidence)
    expect(report.promotable).toBe(false)
  })

  test('a fully clean positive and negative pilot reaches diagnostic pass without promotion', () => {
    const positive = makeCase({ id: 'n9a', expected: introduced })
    const negative = makeCase({ id: 'n9b', expected: decided({ impact: EQualityImpact.Unchanged, concern: false }) })
    const report = analyzeSrpEfficacy({
      cases: [positive, negative],
      rows: [
        rowOf({ evalCase: positive, assessment: assess({ evalCase: positive, concern: 0.9, impact: EQualityImpact.Introduced, focus: 'm1' }) }),
        rowOf({ evalCase: negative, assessment: assess({ evalCase: negative, concern: 0.1, impact: EQualityImpact.Unchanged }) }),
      ],
      judgments: [judgmentFor({ evalCase: positive, warranted: true }), judgmentFor({ evalCase: negative, warranted: false })],
    })
    expect(report.checks.filter((entry) => entry.id !== 'expected-abstentions-correct').every((entry) => entry.status === EGateStatus.Pass)).toBe(true)
    expect(report.checks.find((entry) => entry.id === 'expected-abstentions-correct')?.status).toBe(EGateStatus.InsufficientEvidence)
    expect(report.promotable).toBe(false)
  })

  test('unknown judgments exclude rows from the notification denominators only', () => {
    const evalCase = makeCase({ id: 'n10', expected: introduced })
    const report = analyzeSrpEfficacy({
      cases: [evalCase],
      rows: [rowOf({ evalCase, assessment: assess({ evalCase, concern: 0.9, impact: EQualityImpact.Introduced, focus: 'm1' }) })],
      judgments: [judgmentFor({ evalCase, warranted: null })],
    })
    expect(report.notification.excludedUnknownRows).toBe(1)
    expect(report.notification.judgedRows).toBe(0)
    expect(report.concern.confusion.tp).toBe(1)
  })
})
