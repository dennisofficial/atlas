import type { EvalCase } from '../src/case'
import type { ResultRow } from '../src/results'
import type { PlannedRow } from '../src/run-plan'
import { diagnosticStatusOf, evaluateChecks } from './efficacy-gates'
import { prepareCases, type SrpPilotJudgment } from './efficacy-judgment'
import { zeroRReportOf } from './efficacy-zero-r'
import {
  summarizeAbstention,
  summarizeConcern,
  summarizeEvidence,
  summarizeImpact,
  summarizeNotification,
} from './efficacy-metrics'
import { classifyRows, identityKey } from './efficacy-rows'
import { summarizeInstability, summarizeLatency, summarizeStrata } from './efficacy-stability'
import {
  EFFICACY_REPORT_VERSION,
  ERowClass,
  isInterpretable,
  type ClassifiedRow,
  type UnavailableRow,
} from './efficacy-types'

export type AnalyzeSrpEfficacyArgs = {
  cases: readonly EvalCase[]
  rows: readonly ResultRow[]
  judgments: readonly SrpPilotJudgment[]
  plan?: readonly PlannedRow[] | undefined
  requestedModel?: string | undefined
}

const PILOT_STATEMENT =
  'Nonpromotional pilot diagnostic. Not a statistically calibrated result and no production enablement claim; master switch stays off.'

function unavailableSummary({ rows, rowClass }: { rows: readonly ClassifiedRow[]; rowClass: ERowClass }) {
  const matching = rows.filter((row): row is UnavailableRow => row.rowClass === rowClass)
  const byReason: Record<string, number> = {}
  for (const row of matching) byReason[row.reason] = (byReason[row.reason] ?? 0) + 1
  return { total: matching.length, byReason }
}

export function analyzeSrpEfficacy({ cases, rows, judgments, plan, requestedModel }: AnalyzeSrpEfficacyArgs) {
  const prepared = prepareCases({ cases, judgments })
  const classified = classifyRows({ cases: prepared, rows, plan, requestedModel })
  const live = classified.filter(isInterpretable)
  const plannedTrials = new Map<string, number>()
  for (const row of classified) plannedTrials.set(row.identity.caseId, (plannedTrials.get(row.identity.caseId) ?? 0) + 1)
  const trialCounts = [...plannedTrials.values()]
  const uniformTrials = trialCounts.length > 0 && trialCounts.every((count) => count === trialCounts[0]) ? (trialCounts[0] ?? 1) : 1
  const timings = new Map(rows.map((row) => [identityKey(row), { endToEndMs: row.timing.endToEndMs }]))

  const impact = summarizeImpact({ rows: live })
  const concern = summarizeConcern({ rows: live })
  const abstention = summarizeAbstention({ rows: live })
  const evidence = summarizeEvidence({ rows: live })
  const notification = summarizeNotification({ rows: live, totalPlannedTrials: plannedTrials })
  const instability = summarizeInstability({ rows: classified })
  const operational = unavailableSummary({ rows: classified, rowClass: ERowClass.Operational })
  const structural = unavailableSummary({ rows: classified, rowClass: ERowClass.Structural })

  const zeroR = zeroRReportOf({ cases, judgments, trialsPerCase: uniformTrials })
  const checks = evaluateChecks({
    inputs: {
      operationalAndStructural: operational.total + structural.total,
      zeroR: { impactAccuracy: zeroR.impactAccuracy, concernAccuracy: zeroR.concernAccuracy, insufficientClasses: zeroR.insufficientClasses },
      impactAllEligible: impact.allEligible,
      concernAllEligible: concern.allEligibleAccuracy,
      decisionCoverage: abstention.decisionCoverage,
      expectedAbstain: abstention.expectedAbstain,
      unjustifiedNotifications: notification.confusion.fp,
      wrongEvidenceNotifications: evidence.wrongEvidenceNotifications.numerator,
      actualNotifications: notification.actualNotifications,
      notificationRecall: notification.recall,
      notificationPrecision: notification.precision,
      notificationFlips: instability.notificationFlips.length,
      unjudgedNotifications: notification.unjudgedNotifications,
    },
  })

  return {
    reportVersion: EFFICACY_REPORT_VERSION,
    promotable: false as const,
    statement: PILOT_STATEMENT,
    diagnosticStatus: diagnosticStatusOf({ checks }),
    checks,
    rows: {
      planned: classified.length,
      interpretable: live.length,
      operational,
      structural,
    },
    zeroR: {
      statement: 'Weka 0-R yardstick: predict the most common frozen judgment on this evaluated dataset, independent of row results. Ties are null; no separate training split exists.',
      ...zeroR,
    },
    independent: {
      cases: prepared.length,
      groups: new Set(prepared.map((entry) => entry.group)).size,
      judgedCases: prepared.filter((entry) => entry.judgment.notificationWarranted !== null).length,
      reviewers: [...new Set(prepared.map((entry) => entry.judgment.reviewer))].sort(),
    },
    impact,
    concern,
    abstention,
    evidence,
    notification,
    instability,
    strata: summarizeStrata({ rows: classified }),
    latency: summarizeLatency({ rows: classified, timings }),
  }
}

export type SrpEfficacyReport = ReturnType<typeof analyzeSrpEfficacy>
