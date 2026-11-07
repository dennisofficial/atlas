import type { SharedV4ProviderOptions } from '@ai-sdk/provider'

import { clampEffort, type EEffort, type ModelCard } from '@dltech/atlas-core'

export function reasoningEffortOptions(args: {
  providerId: string
  card: ModelCard | undefined
  effort: EEffort
}): SharedV4ProviderOptions | undefined {
  const map = args.card?.effort
  const rung = clampEffort({ map, effort: args.effort })
  if (rung === undefined) return undefined

  const sent = map?.[rung]
  if (typeof sent !== 'string') return undefined

  return { [args.providerId]: { reasoningEffort: sent } }
}
