import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'

import { clampEffort, type EEffort, type ModelCard } from '@dltech/atlas-core'

type GatewayReasoning = NonNullable<LanguageModelV4CallOptions['reasoning']>

const GATEWAY_REASONING: ReadonlySet<string> = new Set<GatewayReasoning>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

const isGatewayReasoning = (value: string): value is GatewayReasoning =>
  GATEWAY_REASONING.has(value)

/**
 * The gateway's language-model endpoint takes the AI SDK's own `reasoning` call option and maps it
 * to each serving provider's native control, so the rung the catalogue recorded from the model's
 * `reasoning_options` goes out unchanged.
 * https://vercel.com/docs/ai-gateway/models-and-providers/reasoning
 */
export function gatewayReasoning(args: {
  card: ModelCard
  effort: EEffort
}): GatewayReasoning | undefined {
  const rung = clampEffort({ map: args.card.effort, effort: args.effort })
  if (rung === undefined) return undefined

  const sent = args.card.effort?.[rung]
  if (typeof sent !== 'string') return undefined
  return isGatewayReasoning(sent) ? sent : undefined
}
