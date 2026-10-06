import { performance } from 'node:perf_hooks'

import {
  interpretQualityResponse,
  prepareQualityRequest,
  JEV_QUALITY_MODEL,
  type DecisionOutcome,
  type DecisionQuestion,
  type QualityAssessment,
  type QualityPolicy,
  type QualityScope,
} from '@dltech/atlas-core'

import { TaskExecutionError } from '../src/worker'

export type DecisionCaller = (args: {
  state: string
  questions: Record<string, DecisionQuestion>
  signal: AbortSignal
  model: string
}) => Promise<DecisionOutcome>

export type CodeQualityInput = {
  scope: QualityScope
  policyIds: readonly string[]
}

export type CodeQualityOutput = {
  assessments: readonly QualityAssessment[]
  resolvedModel: string | null
  timing: { preparationMs: number; inferenceMs: number; interpretationMs: number }
}

export type CodeQualityTaskDeps = {
  decide: DecisionCaller
  resolvePolicies: (args: { policyIds: readonly string[] }) => readonly QualityPolicy[]
  defaultModel?: string | undefined
}

export async function runCodeQualityTask({
  input,
  model,
  deadlineMs,
  deps,
}: {
  input: CodeQualityInput
  model: string
  deadlineMs: number
  deps: CodeQualityTaskDeps
}): Promise<CodeQualityOutput> {
  const policies = deps.resolvePolicies({ policyIds: input.policyIds })
  const prepareStart = performance.now()
  const request = prepareQualityRequest({ scope: input.scope, policies })
  const preparationMs = performance.now() - prepareStart

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deadlineMs)
  let outcome: DecisionOutcome
  const inferenceStart = performance.now()
  try {
    outcome = await deps.decide({
      state: request.state,
      questions: request.questions,
      signal: controller.signal,
      model: model === '' ? (deps.defaultModel ?? JEV_QUALITY_MODEL) : model,
    })
  } finally {
    clearTimeout(timer)
  }
  const inferenceMs = performance.now() - inferenceStart

  if (!outcome.ok) {
    throw new TaskExecutionError(`decision call failed: ${outcome.fault}`)
  }

  const interpretStart = performance.now()
  const assessments = interpretQualityResponse({
    request,
    scope: input.scope,
    policies,
    answers: outcome.answers,
  })
  const interpretationMs = performance.now() - interpretStart

  return {
    assessments,
    resolvedModel: outcome.model ?? null,
    timing: { preparationMs, inferenceMs, interpretationMs },
  }
}
