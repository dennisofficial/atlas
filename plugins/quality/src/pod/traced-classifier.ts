import { randomUUID } from 'node:crypto'

import {
  looksSecretShaped,
  namesASecretLiteral,
  type ClassifierCallContext,
  type ClassifierOutcome,
  type ClassifierQuestion,
  type ClassifierStatus,
  type DecisionAnswer,
} from '@dltech/atlas-core'
import {
  EAnalyticsLinks,
  type PodAnalytics,
  type PodAnalyticsValue,
  type PodClassifier,
} from '@dltech/atlas-plugin-sdk'

export const AI_GENERATION_EVENT = '$ai_generation'

export type TracedClassifierArgs = {
  classifier: PodClassifier
  analytics: PodAnalytics
  reviewId: string
  status: Extract<ClassifierStatus, { on: true }>
  clock: () => number
}

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  jev: 'jev',
  'openai-decisions': 'openai',
}

const providerLabelOf = ({ provider }: { provider: string }): string =>
  PROVIDER_LABELS[provider] ?? provider

const costOf = ({
  tokens,
  usdPerMillion,
}: {
  tokens: number | null
  usdPerMillion: number | undefined
}): number | null =>
  usdPerMillion === undefined ? null : ((tokens ?? 0) * usdPerMillion) / 1_000_000

const inputContentOf = ({
  state,
  questions,
}: {
  state: string
  questions: Record<string, ClassifierQuestion>
}): string => `${state}\n\n${JSON.stringify(questions)}`

const outputContentOf = (answers: Readonly<Record<string, DecisionAnswer>>): string =>
  JSON.stringify(answers)

const holdsSecret = ({
  path,
  texts,
}: {
  path: string | undefined
  texts: readonly (string | undefined)[]
}): boolean => {
  if (path !== undefined && looksSecretShaped({ path })) return true
  return texts.some((text) => text !== undefined && namesASecretLiteral({ text }))
}

const generationProperties = (args: {
  reviewId: string
  spanId: string
  context: ClassifierCallContext | undefined
  status: TracedClassifierArgs['status']
  state: string
  questions: Record<string, ClassifierQuestion>
  outcome: ClassifierOutcome | undefined
  thrown: string | undefined
  latencyMs: number
}): Readonly<Record<string, PodAnalyticsValue>> => {
  const answers = args.outcome?.ok === true ? args.outcome.answers : undefined
  const fault = args.outcome === undefined || args.outcome.ok ? undefined : args.outcome.fault
  const usage = args.outcome?.ok === true ? args.outcome.usage : undefined
  const inputTokens = usage?.inputTokens ?? null
  const outputTokens = usage?.outputTokens ?? null
  const pricing = args.status.pricing
  const inputCost = costOf({ tokens: inputTokens, usdPerMillion: pricing?.inputUsdPerMillion })
  const outputCost = costOf({ tokens: outputTokens, usdPerMillion: pricing?.outputUsdPerMillion })
  const totalCost = inputCost === null || outputCost === null ? null : inputCost + outputCost
  const input = inputContentOf({ state: args.state, questions: args.questions })
  const output = answers === undefined ? undefined : outputContentOf(answers)
  const withheld = holdsSecret({ path: args.context?.path, texts: [input, output] })
  const policyIds = args.context?.policyIds ?? []
  return {
    $ai_trace_id: args.reviewId,
    $ai_span_id: args.spanId,
    $ai_span_name: `jev:${policyIds.join(',')}`,
    $ai_model: args.status.model,
    $ai_provider: providerLabelOf({ provider: args.status.provider }),
    ...(pricing === undefined ? {} : { $ai_base_url: pricing.endpoint }),
    ...(withheld
      ? {}
      : {
          $ai_input: [{ role: 'user', content: input }],
          ...(output === undefined
            ? {}
            : { $ai_output_choices: [{ role: 'assistant', content: output }] }),
        }),
    $ai_input_tokens: inputTokens,
    $ai_output_tokens: outputTokens,
    $ai_latency: args.latencyMs / 1000,
    $ai_is_error: fault !== undefined || args.thrown !== undefined,
    $ai_error: fault ?? args.thrown ?? null,
    $ai_input_cost_usd: inputCost,
    $ai_output_cost_usd: outputCost,
    $ai_total_cost_usd: totalCost,
    review_id: args.reviewId,
    scope_id: args.context?.scopeId ?? null,
    policy_ids: [...policyIds],
    path: args.context?.path ?? null,
    line_start: args.context?.lineStart ?? null,
    line_end: args.context?.lineEnd ?? null,
    code_withheld: withheld ? 'secret' : null,
  }
}

export const tracedClassifier = (args: TracedClassifierArgs): PodClassifier => ({
  status: () => args.classifier.status(),
  classify: async (call) => {
    const started = args.clock()
    const spanId = randomUUID()
    let outcome: ClassifierOutcome | undefined
    let thrown: string | undefined
    try {
      outcome = await args.classifier.classify({
        state: call.state,
        questions: call.questions,
        signal: call.signal,
      })
      return outcome
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      args.analytics.capture({
        event: AI_GENERATION_EVENT,
        properties: generationProperties({
          reviewId: args.reviewId,
          spanId,
          context: call.context,
          status: args.status,
          state: call.state,
          questions: call.questions,
          outcome,
          thrown,
          latencyMs: Math.max(0, args.clock() - started),
        }),
        links: EAnalyticsLinks.Hashed,
      })
    }
  },
})
