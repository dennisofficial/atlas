import { EQualityReviewStatus } from '@dltech/atlas-core'

import { ESrpExpectationKind } from './expected'
import {
  CONCERN_CLASS_THRESHOLD,
  CONCERN_THRESHOLD_NAME,
  ratioOf,
  type InterpretableRow,
  type Ratio,
} from './efficacy-types'

export type Confusion = { tp: number; fp: number; fn: number; tn: number }

const emptyConfusion = (): Confusion => ({ tp: 0, fp: 0, fn: 0, tn: 0 })

export const isActualCompleted = (row: InterpretableRow): boolean => row.assessment.status === EQualityReviewStatus.Completed

export const isExpectedDecided = (row: InterpretableRow): boolean => row.prepared.expected.kind === ESrpExpectationKind.Decided

export const expectedConcernOf = (row: InterpretableRow): boolean | null =>
  row.prepared.expected.kind === ESrpExpectationKind.Decided ? row.prepared.expected.fields.currentConcern : null

export const predictedConcernOf = (row: InterpretableRow): boolean =>
  isActualCompleted(row) && row.assessment.currentConcernProbability !== null && row.assessment.currentConcernProbability >= CONCERN_CLASS_THRESHOLD

const sortedKey = ({ ids }: { ids: readonly string[] }): string => [...ids].sort().join('\u0000')

export const expectedEvidenceOf = (row: InterpretableRow): readonly string[] | null =>
  row.prepared.expected.kind === ESrpExpectationKind.Decided ? row.prepared.expected.fields.evidenceIds : null

export const evidenceMatches = ({ row }: { row: InterpretableRow }): boolean => {
  const expected = expectedEvidenceOf(row)
  return expected !== null && sortedKey({ ids: expected }) === sortedKey({ ids: row.assessment.evidenceIds })
}

const impactMatches = (row: InterpretableRow): boolean =>
  row.prepared.expected.kind === ESrpExpectationKind.Decided && row.assessment.impact === row.prepared.expected.fields.impact

function confusionOf({ rows }: { rows: readonly InterpretableRow[] }): Confusion {
  const table = emptyConfusion()
  for (const row of rows) {
    const expected = expectedConcernOf(row)
    if (expected === null || !isActualCompleted(row)) continue
    const predicted = predictedConcernOf(row)
    if (expected && predicted) table.tp += 1
    else if (!expected && predicted) table.fp += 1
    else if (expected) table.fn += 1
    else table.tn += 1
  }
  return table
}

export function summarizeImpact({ rows }: { rows: readonly InterpretableRow[] }) {
  const eligible = rows.filter(isExpectedDecided)
  const decisions = eligible.filter(isActualCompleted)
  return {
    onDecisions: ratioOf({ numerator: decisions.filter(impactMatches).length, denominator: decisions.length }),
    allEligible: ratioOf({ numerator: decisions.filter(impactMatches).length, denominator: eligible.length }),
  }
}

export function summarizeConcern({ rows }: { rows: readonly InterpretableRow[] }) {
  const eligible = rows.filter(isExpectedDecided)
  const confusion = confusionOf({ rows })
  const positives = eligible.filter((row) => expectedConcernOf(row) === true)
  const decidedCount = confusion.tp + confusion.fp + confusion.fn + confusion.tn
  return {
    threshold: { name: CONCERN_THRESHOLD_NAME, value: CONCERN_CLASS_THRESHOLD },
    confusion,
    decidedAccuracy: ratioOf({ numerator: confusion.tp + confusion.tn, denominator: decidedCount }),
    allEligibleAccuracy: ratioOf({ numerator: confusion.tp + confusion.tn, denominator: eligible.length }),
    precision: ratioOf({ numerator: confusion.tp, denominator: confusion.tp + confusion.fp }),
    decidedRecall: ratioOf({ numerator: confusion.tp, denominator: confusion.tp + confusion.fn }),
    allEligibleRecall: ratioOf({ numerator: confusion.tp, denominator: positives.length }),
    missedByAbstention: positives.filter((row) => !isActualCompleted(row)).length,
  }
}

export function summarizeAbstention({ rows }: { rows: readonly InterpretableRow[] }) {
  const eligible = rows.filter(isExpectedDecided)
  const expectedAbstain = rows.filter((row) => !isExpectedDecided(row))
  const unexpected = eligible.filter((row) => !isActualCompleted(row))
  const count = (status: EQualityReviewStatus): number => rows.filter((row) => row.assessment.status === status).length
  return {
    expectedDecided: eligible.length,
    expectedAbstain: ratioOf({ numerator: expectedAbstain.filter((row) => !isActualCompleted(row)).length, denominator: expectedAbstain.length }),
    expectedAbstainButDecided: expectedAbstain.filter(isActualCompleted).length,
    actual: {
      completed: count(EQualityReviewStatus.Completed),
      inconclusive: count(EQualityReviewStatus.Inconclusive),
      skipped: count(EQualityReviewStatus.Skipped),
    },
    unexpected: {
      onPositive: unexpected.filter((row) => expectedConcernOf(row) === true).length,
      onNegative: unexpected.filter((row) => expectedConcernOf(row) === false).length,
    },
    decisionCoverage: ratioOf({ numerator: eligible.filter(isActualCompleted).length, denominator: eligible.length }),
  }
}

export type EvidenceSummary = {
  exactTuple: { all: Ratio; expectedEmpty: Ratio; expectedNonEmpty: Ratio }
  wrongEvidenceNotifications: Ratio
}

export function summarizeEvidence({ rows }: { rows: readonly InterpretableRow[] }): EvidenceSummary {
  const decisions = rows.filter((row) => isExpectedDecided(row) && isActualCompleted(row))
  const ratioFor = (subset: readonly InterpretableRow[]): Ratio =>
    ratioOf({ numerator: subset.filter((row) => evidenceMatches({ row })).length, denominator: subset.length })
  const notified = rows.filter((row) => row.notified)
  const wronglyGrounded = notified.filter((row) => {
    const expected = expectedEvidenceOf(row)
    if (expected === null) return true
    return row.assessment.evidenceIds.length === 0 || !row.assessment.evidenceIds.every((id) => expected.includes(id))
  })
  return {
    exactTuple: {
      all: ratioFor(decisions),
      expectedEmpty: ratioFor(decisions.filter((row) => expectedEvidenceOf(row)?.length === 0)),
      expectedNonEmpty: ratioFor(decisions.filter((row) => (expectedEvidenceOf(row)?.length ?? 0) > 0)),
    },
    wrongEvidenceNotifications: ratioOf({ numerator: wronglyGrounded.length, denominator: notified.length }),
  }
}

export function summarizeNotification({ rows, totalPlannedTrials }: { rows: readonly InterpretableRow[]; totalPlannedTrials: ReadonlyMap<string, number> }) {
  const judged = rows.filter((row) => row.prepared.judgment.notificationWarranted !== null)
  const confusion = emptyConfusion()
  let abstainedOnUnwarranted = 0
  for (const row of judged) {
    const warranted = row.prepared.judgment.notificationWarranted === true
    if (warranted && row.notified) confusion.tp += 1
    else if (warranted) confusion.fn += 1
    else if (row.notified) confusion.fp += 1
    else if (isActualCompleted(row)) confusion.tn += 1
    else abstainedOnUnwarranted += 1
  }
  const warrantedRows = judged.filter((row) => row.prepared.judgment.notificationWarranted === true)
  const perCase = new Map<string, { notified: number }>()
  for (const row of rows) {
    const entry = perCase.get(row.identity.caseId) ?? { notified: 0 }
    if (row.notified) entry.notified += 1
    perCase.set(row.identity.caseId, entry)
  }
  const coverageLimited = [...new Set(warrantedRows.filter((row) => row.prepared.scope.evidence.length === 0).map((row) => row.identity.caseId))].sort()
  const unjudgedNotifications = rows.filter((row) => row.notified && row.prepared.judgment.notificationWarranted === null).length
  return {
    judgedRows: judged.length,
    excludedUnknownRows: rows.length - judged.length,
    unjudgedNotifications,
    confusion,
    missedByAbstention: warrantedRows.filter((row) => !isActualCompleted(row)).length,
    abstainedOnUnwarranted,
    actualNotifications: rows.filter((row) => row.notified).length,
    precision: ratioOf({ numerator: confusion.tp, denominator: confusion.tp + confusion.fp }),
    recall: ratioOf({ numerator: confusion.tp, denominator: warrantedRows.length }),
    coverageLimitedCaseIds: coverageLimited,
    byCase: [...perCase.entries()]
      .filter(([, entry]) => entry.notified > 0)
      .map(([caseId, entry]) => ({
        caseId,
        notified: entry.notified,
        trials: totalPlannedTrials.get(caseId) ?? 0,
        frequency: ratioOf({ numerator: entry.notified, denominator: totalPlannedTrials.get(caseId) ?? 0 }),
      }))
      .sort((left, right) => left.caseId.localeCompare(right.caseId)),
  }
}
