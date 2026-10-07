import { EQualityImpact } from '@dltech/atlas-core'

import type { EvalCase } from '../src/case'
import { ratioOf, type Ratio } from './efficacy-types'
import { ESrpExpectationKind, srpExpectedSchema, type SrpExpectedFields } from './expected'
import type { SrpPilotJudgment } from './efficacy-judgment'

export type ZeroRPrediction = {
  impact: (typeof EQualityImpact)[keyof typeof EQualityImpact] | null
  currentConcern: boolean | null
  evidenceIds: readonly string[]
  notificationWarranted: boolean | null
}

export type ZeroRReport = {
  prediction: ZeroRPrediction
  impactAccuracy: Ratio
  concernAccuracy: Ratio
  notificationRecall: Ratio
  notificationPrecision: Ratio
  insufficientClasses: boolean
}

function mode<T>({ values }: { values: readonly T[] }): T | null {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const first = ordered[0]
  if (first === undefined) return null
  const tied = ordered.filter(([, count]) => count === first[1]).length > 1
  return tied ? null : first[0]
}

const countMatches = <T>({ modeValue, values }: { modeValue: T | null; values: readonly T[] }): Ratio => {
  if (modeValue === null || values.length === 0) return ratioOf({ numerator: 0, denominator: values.length })
  return ratioOf({ numerator: values.filter((value) => value === modeValue).length, denominator: values.length })
}

export function zeroRBaselineOf({
  cases,
  judgments,
}: {
  cases: readonly EvalCase[]
  judgments: readonly SrpPilotJudgment[]
}): ZeroRPrediction {
  const fields: SrpExpectedFields[] = []
  for (const evalCase of cases) {
    const decoded = srpExpectedSchema.safeParse(evalCase.expected)
    if (decoded.success && decoded.data.kind === ESrpExpectationKind.Decided) fields.push(decoded.data.fields)
  }
  return {
    impact: mode({ values: fields.map((field) => field.impact) }),
    currentConcern: mode({ values: fields.map((field) => field.currentConcern) }),
    evidenceIds: [],
    notificationWarranted: mode({ values: judgments.filter((judgment) => judgment.notificationWarranted !== null).map((judgment) => judgment.notificationWarranted) }),
  }
}

export function zeroRReportOf({
  cases,
  judgments,
  trialsPerCase,
}: {
  cases: readonly EvalCase[]
  judgments: readonly SrpPilotJudgment[]
  trialsPerCase: number
}): ZeroRReport {
  const fields: SrpExpectedFields[] = []
  for (const evalCase of cases) {
    const decoded = srpExpectedSchema.safeParse(evalCase.expected)
    if (decoded.success && decoded.data.kind === ESrpExpectationKind.Decided) fields.push(decoded.data.fields)
  }
  const prediction = zeroRBaselineOf({ cases, judgments })
  const impactValues = fields.map((field) => field.impact)
  const concernValues = fields.map((field) => field.currentConcern)
  const warranted = judgments.filter((judgment) => judgment.notificationWarranted !== null).map((judgment) => judgment.notificationWarranted)
  const expectedWarranted = warranted.filter((value) => value).length
  const actualNotifications = prediction.notificationWarranted === true ? warranted.length * trialsPerCase : 0
  const truePositives = prediction.notificationWarranted === true ? expectedWarranted * trialsPerCase : 0
  const uniqueImpacts = new Set(impactValues).size
  const uniqueConcerns = new Set(concernValues).size
  const uniqueNotifications = new Set(warranted).size
  return {
    prediction,
    impactAccuracy: countMatches({ modeValue: prediction.impact, values: impactValues }),
    concernAccuracy: countMatches({ modeValue: prediction.currentConcern, values: concernValues }),
    notificationRecall: prediction.notificationWarranted === null || expectedWarranted === 0 ? ratioOf({ numerator: 0, denominator: 0 }) : ratioOf({ numerator: truePositives, denominator: expectedWarranted * trialsPerCase }),
    notificationPrecision: prediction.notificationWarranted === null || actualNotifications === 0 ? ratioOf({ numerator: 0, denominator: 0 }) : ratioOf({ numerator: truePositives, denominator: actualNotifications }),
    insufficientClasses: uniqueImpacts < 2 && uniqueConcerns < 2 && uniqueNotifications < 2,
  }
}
