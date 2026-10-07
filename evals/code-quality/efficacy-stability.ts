import { timingStats } from '../src/metrics'
import { identityKey } from './efficacy-rows'
import { isActualCompleted, isExpectedDecided, predictedConcernOf, expectedConcernOf } from './efficacy-metrics'
import { ratioOf, isInterpretable, type ClassifiedRow, type InterpretableRow } from './efficacy-types'

const groupKey = ({ row }: { row: ClassifiedRow }): string => JSON.stringify([row.identity.caseId, row.identity.variantId])

const signatureOf = (row: InterpretableRow): string =>
  JSON.stringify({
    status: row.assessment.status,
    impact: row.assessment.impact,
    concernClass: isActualCompleted(row) ? predictedConcernOf(row) : null,
    transition: row.assessment.transition,
    evidenceIds: [...row.assessment.evidenceIds].sort(),
    notifiable: row.notified,
  })

export function summarizeInstability({ rows }: { rows: readonly ClassifiedRow[] }) {
  const groups = new Map<string, ClassifiedRow[]>()
  for (const row of rows) groups.set(groupKey({ row }), [...(groups.get(groupKey({ row })) ?? []), row])
  const unstable: { caseId: string; variantId: string; trialIds: readonly string[]; signatures: number }[] = []
  const notificationFlips: { caseId: string; variantId: string; trialIds: readonly string[]; notified: number; trials: number }[] = []
  const operationalVariable: { caseId: string; variantId: string; trialIds: readonly string[] }[] = []
  let comparable = 0
  for (const members of groups.values()) {
    const first = members[0]
    if (first === undefined) continue
    const identity = { caseId: first.identity.caseId, variantId: first.identity.variantId }
    const live = members.filter(isInterpretable)
    const trialIds = live.map((row) => row.identity.trialId).sort()
    if (live.length < members.length && live.length > 0) {
      operationalVariable.push({ ...identity, trialIds: members.map((row) => row.identity.trialId).sort() })
    }
    if (live.length < 2) continue
    comparable += 1
    const signatures = new Set(live.map(signatureOf)).size
    if (signatures > 1) unstable.push({ ...identity, trialIds, signatures })
    const notified = live.filter((row) => row.notified).length
    if (notified > 0 && notified < live.length) notificationFlips.push({ ...identity, trialIds, notified, trials: live.length })
  }
  return {
    comparableGroups: comparable,
    unstableOutcomes: ratioOf({ numerator: unstable.length, denominator: comparable }),
    unstable,
    notificationFlips,
    operationalVariable,
  }
}

export function summarizeStrata({ rows }: { rows: readonly ClassifiedRow[] }) {
  const kinds = [...new Set(rows.map((row) => row.prepared.scope.kind))].sort()
  const stratum = (members: readonly ClassifiedRow[]) => {
    const live = members.filter(isInterpretable)
    const eligible = live.filter(isExpectedDecided)
    const concernHits = eligible.filter((row) => isActualCompleted(row) && predictedConcernOf(row) === expectedConcernOf(row)).length
    return {
      independentCases: new Set(members.map((row) => row.identity.caseId)).size,
      independentGroups: new Set(members.map((row) => row.prepared.group)).size,
      rows: members.length,
      interpretable: live.length,
      decisionCoverage: ratioOf({ numerator: eligible.filter(isActualCompleted).length, denominator: eligible.length }),
      concernAccuracyAllEligible: ratioOf({ numerator: concernHits, denominator: eligible.length }),
      notifications: live.filter((row) => row.notified).length,
    }
  }
  return {
    overall: stratum(rows),
    byScopeKind: Object.fromEntries(kinds.map((kind) => [kind, stratum(rows.filter((row) => row.prepared.scope.kind === kind))])),
  }
}

export function summarizeLatency({ rows, timings }: { rows: readonly ClassifiedRow[]; timings: ReadonlyMap<string, { endToEndMs: number }> }) {
  const live = rows.filter(isInterpretable)
  const samples = live.map((row) => timings.get(identityKey(row.identity))?.endToEndMs ?? row.endToEndMs)
  return { endToEndMs: timingStats({ samples }), excludedErrorRows: rows.length - live.length }
}
