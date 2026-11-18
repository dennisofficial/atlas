import type { SharedV4ProviderOptions } from '@ai-sdk/provider'

import {
  ANTHROPIC_PROVIDER_ID,
  clampEffort,
  DEFAULT_EFFORT,
  findCard,
  type EEffort,
  type ModelCard,
} from '@dltech/atlas-core'
import { generatedCatalogue } from '@dltech/atlas-models'

// Without display: "summarized" Anthropic returns signature-only thinking blocks: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
export function anthropicThinkingOptions(args: {
  card: ModelCard | undefined
  effort: EEffort
}): SharedV4ProviderOptions | undefined {
  const rung = clampEffort({ map: args.card?.effort, effort: args.effort })
  if (rung === undefined) return undefined

  const sent = args.card?.effort?.[rung]
  if (sent === undefined) return undefined

  if (typeof sent === 'number') {
    return { anthropic: { thinking: { type: 'enabled', budgetTokens: sent } } }
  }

  return {
    anthropic: {
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: sent,
    },
  }
}

export const anthropicThinkingOptionsOf = (modelId: string): SharedV4ProviderOptions | undefined =>
  anthropicThinkingOptions({
    card: findCard({
      catalog: generatedCatalogue(),
      ref: { providerId: ANTHROPIC_PROVIDER_ID, modelId },
    }),
    effort: DEFAULT_EFFORT,
  })
