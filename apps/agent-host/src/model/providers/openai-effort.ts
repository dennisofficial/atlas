import type { SharedV4ProviderOptions } from '@ai-sdk/provider'

import { clampEffort, type EEffort, type ModelCard } from '@dltech/atlas-core'

// OpenAI spells "do not reason" as a rung named `none`, and which rungs exist varies per model:
// https://platform.openai.com/docs/guides/reasoning
export function openaiEffortOptions(args: {
  card: ModelCard | undefined
  effort: EEffort
}): SharedV4ProviderOptions | undefined {
  const map = args.card?.effort
  const rung = clampEffort({ map, effort: args.effort })
  if (rung === undefined) return undefined

  const sent = map?.[rung]
  if (typeof sent !== 'string') return undefined

  return { openai: { reasoningEffort: sent } }
}
