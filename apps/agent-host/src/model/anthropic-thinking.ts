import type { SharedV4ProviderOptions } from '@ai-sdk/provider'

import {
  ANTHROPIC_PROVIDER_ID,
  clampEffort,
  DEFAULT_EFFORT,
  findCard,
  type ModelCard,
} from '@dltech/atlas-core'
import { generatedCatalogue } from '@dltech/atlas-models'

// Without display: "summarized" Anthropic returns signature-only thinking blocks: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
export function anthropicThinkingOptions(
  card: ModelCard | undefined,
): SharedV4ProviderOptions | undefined {
  const rung = clampEffort({ map: card?.effort, effort: DEFAULT_EFFORT })
  if (rung === undefined) return undefined

  const sent = card?.effort?.[rung]
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
  anthropicThinkingOptions(
    findCard({
      catalog: generatedCatalogue(),
      ref: { providerId: ANTHROPIC_PROVIDER_ID, modelId },
    }),
  )
