import type { DecisionAnswer, DecisionQuestion } from '../ports/decision.port'
import { JEV_MODEL } from '../policy/classifier/jev'
import type { QualityScope } from './change'
import {
  EQualityImpact,
  EQualityReviewStatus,
  EQualityTransition,
  QualityContractError,
  type QualityAssessment,
  type QualityPolicy,
} from './policy'

export const JEV_QUALITY_MODEL = JEV_MODEL

export const MAX_CHOICE_OPTIONS = 255

export type QualityQuestionBinding = { policyId: string; questionKey: string }

export type QualityDecisionRequest = {
  state: string
  questions: Record<string, DecisionQuestion>
  bindings: Record<string, QualityQuestionBinding>
  policyVersions: Record<string, string>
}

const prefixed = ({ policyId, questionKey }: QualityQuestionBinding): string => `${policyId}:${questionKey}`

function assertChoiceWithinLimit({ policy, key, question }: { policy: QualityPolicy; key: string; question: DecisionQuestion }): void {
  if (question.type !== 'choice') return
  const options = Object.keys(question.criteria).length
  if (options <= MAX_CHOICE_OPTIONS) return
  throw new QualityContractError(
    `quality policy "${policy.id}" question "${key}" has ${options} choice options, over the ${MAX_CHOICE_OPTIONS} limit`,
  )
}

function serializeState({ scope, policies }: { scope: QualityScope; policies: readonly QualityPolicy[] }): string {
  return JSON.stringify({
    scope: {
      before: scope.before,
      after: scope.after,
      diff: scope.diff,
      dependencyContext: scope.dependencyContext,
      evidence: scope.evidence,
    },
    policies: policies.map((policy) => ({
      id: policy.id,
      definition: policy.definition,
      exceptions: policy.exceptions,
    })),
  })
}

export function prepareQualityRequest({
  scope,
  policies,
}: {
  scope: QualityScope
  policies: readonly QualityPolicy[]
}): QualityDecisionRequest {
  const questions: Record<string, DecisionQuestion> = {}
  const bindings: Record<string, QualityQuestionBinding> = {}
  const policyVersions: Record<string, string> = {}

  for (const policy of policies) {
    if (policy.id in policyVersions) throw new QualityContractError(`quality policy "${policy.id}" requested twice`)
    policyVersions[policy.id] = policy.version

    for (const [questionKey, question] of Object.entries(policy.questions({ scope }))) {
      assertChoiceWithinLimit({ policy, key: questionKey, question })
      const id = prefixed({ policyId: policy.id, questionKey })
      if (id in questions) throw new QualityContractError(`quality question id "${id}" is ambiguous`)
      questions[id] = question
      bindings[id] = { policyId: policy.id, questionKey }
    }
  }

  return { state: serializeState({ scope, policies }), questions, bindings, policyVersions }
}

const isProbability = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1

function choiceProblem({ answer, options }: { answer: DecisionAnswer; options: readonly string[] }): string | null {
  if (answer.choice === undefined || !options.includes(answer.choice)) return 'choice is not one of the offered options'
  const probabilities = answer.probabilities
  if (probabilities === undefined) return null
  const entries = Object.entries(probabilities)
  if (entries.some(([option, value]) => !options.includes(option) || !isProbability(value))) {
    return 'probabilities name unknown options or fall outside [0, 1]'
  }
  const chosen = probabilities[answer.choice] ?? 0
  if (entries.some(([, value]) => value > chosen)) return 'choice contradicts its own probabilities'
  return null
}

function answerProblem({ question, answer }: { question: DecisionQuestion; answer: DecisionAnswer | undefined }): string | null {
  if (answer === undefined) return 'no answer returned'
  if (answer.confidence !== undefined && !isProbability(answer.confidence)) return 'confidence falls outside [0, 1]'
  if (question.type === 'noul') {
    return answer.noul !== undefined && isProbability(answer.noul) ? null : 'noul is missing or falls outside [0, 1]'
  }
  if (question.type === 'score') {
    return answer.score !== undefined && Number.isFinite(answer.score) ? null : 'score is missing or not finite'
  }
  return choiceProblem({ answer, options: Object.keys(question.criteria) })
}

function inconclusive({
  policy,
  scope,
  rawAnswers,
  detail,
}: {
  policy: QualityPolicy
  scope: QualityScope
  rawAnswers: Readonly<Record<string, DecisionAnswer>>
  detail: string
}): QualityAssessment {
  return {
    policyId: policy.id,
    policyVersion: policy.version,
    scopeId: scope.id,
    status: EQualityReviewStatus.Inconclusive,
    impact: EQualityImpact.Uncertain,
    currentConcernProbability: null,
    transition: EQualityTransition.None,
    evidenceIds: [],
    rawAnswers,
    detail,
  }
}

function interpretPolicy({
  request,
  scope,
  policy,
  answers,
}: {
  request: QualityDecisionRequest
  scope: QualityScope
  policy: QualityPolicy
  answers: Readonly<Record<string, DecisionAnswer>>
}): QualityAssessment {
  const requestedVersion = request.policyVersions[policy.id]
  if (requestedVersion === undefined) throw new QualityContractError(`quality policy "${policy.id}" is not part of the request`)

  const rawAnswers: Record<string, DecisionAnswer> = {}
  const problems: string[] = []
  for (const [id, binding] of Object.entries(request.bindings)) {
    if (binding.policyId !== policy.id) continue
    const question = request.questions[id]
    if (question === undefined) continue
    const answer = answers[id]
    if (answer !== undefined) rawAnswers[binding.questionKey] = answer
    const problem = answerProblem({ question, answer })
    if (problem !== null) problems.push(`${binding.questionKey}: ${problem}`)
  }

  if (requestedVersion !== policy.version) {
    return inconclusive({ policy, scope, rawAnswers, detail: `request prepared for policy version ${requestedVersion}` })
  }
  if (problems.length > 0) return inconclusive({ policy, scope, rawAnswers, detail: problems.join('; ') })
  return policy.interpret({ scope, answers: rawAnswers })
}

export function interpretQualityResponse({
  request,
  scope,
  policies,
  answers,
}: {
  request: QualityDecisionRequest
  scope: QualityScope
  policies: readonly QualityPolicy[]
  answers: Readonly<Record<string, DecisionAnswer>>
}): readonly QualityAssessment[] {
  return policies.map((policy) => interpretPolicy({ request, scope, policy, answers }))
}
