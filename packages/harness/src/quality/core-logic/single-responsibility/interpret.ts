import {
  EQualityImpact,
  EQualityReviewStatus,
  EQualityTransition,
  type DecisionAnswer,
  type QualityAssessment,
  type QualityScope,
} from '@dltech/atlas-core'

import { SRP_POLICY_ID, SRP_POLICY_VERSION } from './identity'
import {
  FOCUS_NONE,
  FOCUS_UNCERTAIN,
  QUESTION_CONCERN,
  QUESTION_FOCUS,
  QUESTION_IMPACT,
} from './keys'

export const CONCERN_INTRODUCE_THRESHOLD = 0.8
export const IMPACT_CONFIDENCE_THRESHOLD = 0.8
export const FOCUS_CONFIDENCE_THRESHOLD = 0.8
export const CONCERN_RESOLVE_THRESHOLD = 0.2

type Read<T> = ({ ok: true } & T) | { ok: false; problem: string }

const isProbability = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1

function readConcern({ answer }: { answer: DecisionAnswer | undefined }): Read<{
  probability: number
}> {
  if (answer === undefined) return { ok: false, problem: 'no answer returned' }
  if (answer.noul === undefined || !isProbability(answer.noul)) {
    return { ok: false, problem: 'noul is missing or falls outside [0, 1]' }
  }
  return { ok: true, probability: answer.noul }
}

function readChoice({
  answer,
  options,
}: {
  answer: DecisionAnswer | undefined
  options: readonly string[]
}): Read<{ choice: string; probability: number }> {
  if (answer === undefined) return { ok: false, problem: 'no answer returned' }
  if (answer.choice === undefined || !options.includes(answer.choice)) {
    return { ok: false, problem: 'choice is not one of the offered options' }
  }
  const probability = answer.probabilities?.[answer.choice] ?? answer.confidence
  if (probability === undefined)
    return { ok: false, problem: 'choice carries no probability or confidence' }
  if (!isProbability(probability))
    return { ok: false, problem: 'choice probability falls outside [0, 1]' }
  return { ok: true, choice: answer.choice, probability }
}

function readImpact({ answer }: { answer: DecisionAnswer | undefined }): Read<{
  impact: EQualityImpact
  probability: number
}> {
  const read = readChoice({ answer, options: Object.values(EQualityImpact) })
  if (!read.ok) return read
  const impact = Object.values(EQualityImpact).find((value) => value === read.choice)
  return impact === undefined
    ? { ok: false, problem: 'choice is not one of the offered options' }
    : { ok: true, impact, probability: read.probability }
}

function readFocus({
  answer,
  scope,
}: {
  answer: DecisionAnswer | undefined
  scope: QualityScope
}): Read<{ candidateId: string | null; probability: number }> {
  const options = [FOCUS_NONE, FOCUS_UNCERTAIN, ...scope.evidence.map((evidence) => evidence.id)]
  const read = readChoice({ answer, options })
  if (!read.ok) return read
  const candidate = scope.evidence.find((evidence) => evidence.id === read.choice)
  return { ok: true, candidateId: candidate?.id ?? null, probability: read.probability }
}

const NEW_OR_WORSENED: readonly EQualityImpact[] = [
  EQualityImpact.Introduced,
  EQualityImpact.Worsened,
]
const RESOLVING: readonly EQualityImpact[] = [
  EQualityImpact.Resolved,
  EQualityImpact.Improved,
  EQualityImpact.Unchanged,
]

function contradiction({
  concern,
  impact,
  probability,
}: {
  concern: number
  impact: EQualityImpact
  probability: number
}): string | null {
  if (probability < IMPACT_CONFIDENCE_THRESHOLD) return null
  const lowConcernNewImpact =
    concern <= CONCERN_RESOLVE_THRESHOLD && NEW_OR_WORSENED.includes(impact)
  const highConcernResolved =
    concern >= CONCERN_INTRODUCE_THRESHOLD && impact === EQualityImpact.Resolved
  if (!lowConcernNewImpact && !highConcernResolved) return null
  return `currentConcern ${concern} contradicts a confident ${impact} impact`
}

function inconclusive({
  scope,
  answers,
  detail,
}: {
  scope: QualityScope
  answers: Readonly<Record<string, DecisionAnswer>>
  detail: string
}): QualityAssessment {
  return {
    policyId: SRP_POLICY_ID,
    policyVersion: SRP_POLICY_VERSION,
    scopeId: scope.id,
    status: EQualityReviewStatus.Inconclusive,
    impact: EQualityImpact.Uncertain,
    currentConcernProbability: null,
    transition: EQualityTransition.None,
    evidenceIds: [],
    rawAnswers: answers,
    detail,
  }
}

export function interpret({
  scope,
  answers,
}: {
  scope: QualityScope
  answers: Readonly<Record<string, DecisionAnswer>>
}): QualityAssessment {
  const concern = readConcern({ answer: answers[QUESTION_CONCERN] })
  if (!concern.ok)
    return inconclusive({ scope, answers, detail: `${QUESTION_CONCERN}: ${concern.problem}` })
  const impact = readImpact({ answer: answers[QUESTION_IMPACT] })
  if (!impact.ok)
    return inconclusive({ scope, answers, detail: `${QUESTION_IMPACT}: ${impact.problem}` })
  const focus = readFocus({ answer: answers[QUESTION_FOCUS], scope })
  if (!focus.ok)
    return inconclusive({ scope, answers, detail: `${QUESTION_FOCUS}: ${focus.problem}` })

  const conflict = contradiction({
    concern: concern.probability,
    impact: impact.impact,
    probability: impact.probability,
  })
  if (conflict !== null) return inconclusive({ scope, answers, detail: conflict })

  if (impact.impact === EQualityImpact.Uncertain) {
    return inconclusive({
      scope,
      answers,
      detail: 'the model declared its impact assessment uncertain',
    })
  }

  const completed = ({
    transition,
    evidenceIds,
  }: {
    transition: EQualityTransition
    evidenceIds: readonly string[]
  }): QualityAssessment => ({
    policyId: SRP_POLICY_ID,
    policyVersion: SRP_POLICY_VERSION,
    scopeId: scope.id,
    status: EQualityReviewStatus.Completed,
    impact: impact.impact,
    currentConcernProbability: concern.probability,
    transition,
    evidenceIds,
    rawAnswers: answers,
  })

  const impactConfident = impact.probability >= IMPACT_CONFIDENCE_THRESHOLD
  if (concern.probability >= CONCERN_INTRODUCE_THRESHOLD) {
    if (!impactConfident || !NEW_OR_WORSENED.includes(impact.impact)) {
      return completed({ transition: EQualityTransition.TrackDebt, evidenceIds: [] })
    }
    const focused =
      focus.candidateId !== null && focus.probability >= FOCUS_CONFIDENCE_THRESHOLD
        ? [focus.candidateId]
        : []
    return completed({ transition: EQualityTransition.Introduce, evidenceIds: focused })
  }
  if (
    concern.probability <= CONCERN_RESOLVE_THRESHOLD &&
    impactConfident &&
    RESOLVING.includes(impact.impact)
  ) {
    return completed({ transition: EQualityTransition.Resolve, evidenceIds: [] })
  }
  return completed({ transition: EQualityTransition.None, evidenceIds: [] })
}
