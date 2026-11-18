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

// The gateway maps the AI SDK `reasoning` call option to each serving provider's native control:
// https://vercel.com/docs/ai-gateway/models-and-providers/reasoning
export function gatewayReasoning(args: {
  card: ModelCard | undefined
  effort: EEffort
}): GatewayReasoning | undefined {
  const map = args.card?.effort
  const rung = clampEffort({ map, effort: args.effort })
  if (rung === undefined) return undefined

  const sent = map?.[rung]
  if (typeof sent !== 'string') return undefined
  return isGatewayReasoning(sent) ? sent : undefined
}
