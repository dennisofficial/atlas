import type { Ratio } from './efficacy-types'

export enum EGateStatus {
  Pass = 'pass',
  Fail = 'fail',
  InsufficientEvidence = 'insufficient_evidence',
}

export enum EDiagnosticStatus {
  Blocked = 'blocked',
  InsufficientEvidence = 'insufficient_evidence',
  DiagnosticPass = 'diagnostic_pass',
}

export type DiagnosticCheck = { id: string; status: EGateStatus; detail: string }

export const IMPACT_ACCURACY_MIN = 0.9
export const CONCERN_ACCURACY_MIN = 0.9
export const DECISION_COVERAGE_MIN = 0.9
export const NOTIFICATION_RECALL_MIN = 0.8
export const NOTIFICATION_PRECISION_MIN = 0.95

const show = ({ ratio }: { ratio: Ratio }): string => `${ratio.numerator}/${ratio.denominator}`

export type ZeroRGates = { impactAccuracy: Ratio; concernAccuracy: Ratio; insufficientClasses: boolean }

const atLeast = ({ id, ratio, min }: { id: string; ratio: Ratio; min: number }): DiagnosticCheck => {
  const detail = `${show({ ratio })} required >= ${min}`
  if (ratio.value === null) return { id, status: EGateStatus.InsufficientEvidence, detail }
  return { id, status: ratio.value >= min ? EGateStatus.Pass : EGateStatus.Fail, detail }
}

const zeroOf = ({ id, count, denominator }: { id: string; count: number; denominator: number }): DiagnosticCheck => {
  const detail = `${count} of ${denominator} actual notifications`
  if (denominator === 0) return { id, status: EGateStatus.InsufficientEvidence, detail }
  return { id, status: count === 0 ? EGateStatus.Pass : EGateStatus.Fail, detail }
}

export type GateInputs = {
  operationalAndStructural: number
  zeroR: ZeroRGates
  impactAllEligible: Ratio
  concernAllEligible: Ratio
  decisionCoverage: Ratio
  expectedAbstain: Ratio
  unjustifiedNotifications: number
  wrongEvidenceNotifications: number
  actualNotifications: number
  notificationRecall: Ratio
  notificationPrecision: Ratio
  notificationFlips: number
  unjudgedNotifications: number
}

export function evaluateChecks({ inputs }: { inputs: GateInputs }): readonly DiagnosticCheck[] {
  return [
    {
      id: 'no-operational-or-structural-failures',
      status: inputs.operationalAndStructural === 0 ? EGateStatus.Pass : EGateStatus.Fail,
      detail: `${inputs.operationalAndStructural} failing rows`,
    },
    (() => {
      if (inputs.zeroR.insufficientClasses) {
        return { id: 'beats-zero-r', status: EGateStatus.InsufficientEvidence, detail: 'frozen judgments contain a single class; model accuracy cannot beat a mode baseline' }
      }
      const model = inputs.impactAllEligible.value
      const mode = inputs.zeroR.impactAccuracy.value
      if (model === null || mode === null) return { id: 'beats-zero-r', status: EGateStatus.InsufficientEvidence, detail: `impact ${show({ ratio: inputs.impactAllEligible })} vs mode ${show({ ratio: inputs.zeroR.impactAccuracy })}` }
      if (model > mode) return { id: 'beats-zero-r', status: EGateStatus.Pass, detail: `impact ${show({ ratio: inputs.impactAllEligible })} beats mode ${show({ ratio: inputs.zeroR.impactAccuracy })}` }
      if (model === mode) return { id: 'beats-zero-r', status: EGateStatus.InsufficientEvidence, detail: `impact ${show({ ratio: inputs.impactAllEligible })} only ties mode ${show({ ratio: inputs.zeroR.impactAccuracy })}; no gain demonstrated` }
      return { id: 'beats-zero-r', status: EGateStatus.Fail, detail: `impact ${show({ ratio: inputs.impactAllEligible })} is below mode ${show({ ratio: inputs.zeroR.impactAccuracy })}` }
    })(),
    atLeast({ id: 'impact-accuracy-all-eligible', ratio: inputs.impactAllEligible, min: IMPACT_ACCURACY_MIN }),
    atLeast({ id: 'concern-accuracy-all-eligible', ratio: inputs.concernAllEligible, min: CONCERN_ACCURACY_MIN }),
    atLeast({ id: 'decision-coverage', ratio: inputs.decisionCoverage, min: DECISION_COVERAGE_MIN }),
    atLeast({ id: 'expected-abstentions-correct', ratio: inputs.expectedAbstain, min: 1 }),
    inputs.unjudgedNotifications > 0
      ? { id: 'no-unjustified-notification', status: EGateStatus.InsufficientEvidence, detail: `${inputs.unjudgedNotifications} notifications on cases whose judgment is unknown` }
      : zeroOf({ id: 'no-unjustified-notification', count: inputs.unjustifiedNotifications, denominator: inputs.actualNotifications }),
    zeroOf({ id: 'no-wrongly-grounded-notification', count: inputs.wrongEvidenceNotifications, denominator: inputs.actualNotifications }),
    atLeast({ id: 'notification-recall', ratio: inputs.notificationRecall, min: NOTIFICATION_RECALL_MIN }),
    atLeast({ id: 'notification-precision', ratio: inputs.notificationPrecision, min: NOTIFICATION_PRECISION_MIN }),
    {
      id: 'zero-notification-flips',
      status: inputs.notificationFlips === 0 ? EGateStatus.Pass : EGateStatus.Fail,
      detail: `${inputs.notificationFlips} flipping groups`,
    },
    inputs.zeroR.concernAccuracy.value !== null && inputs.zeroR.concernAccuracy.value >= CONCERN_ACCURACY_MIN
      ? { id: 'concern-gain-over-zero-r', status: EGateStatus.InsufficientEvidence, detail: `mode concern accuracy ${show({ ratio: inputs.zeroR.concernAccuracy })} already meets the gate; a passing score here is not evidence beyond the mode` }
      : { id: 'concern-gain-over-zero-r', status: EGateStatus.Pass, detail: `mode concern accuracy ${show({ ratio: inputs.zeroR.concernAccuracy })} leaves room to demonstrate gain` },
  ]
}

export function diagnosticStatusOf({ checks }: { checks: readonly DiagnosticCheck[] }): EDiagnosticStatus {
  if (checks.some((check) => check.status === EGateStatus.Fail)) return EDiagnosticStatus.Blocked
  if (checks.some((check) => check.status === EGateStatus.InsufficientEvidence)) return EDiagnosticStatus.InsufficientEvidence
  return EDiagnosticStatus.DiagnosticPass
}
