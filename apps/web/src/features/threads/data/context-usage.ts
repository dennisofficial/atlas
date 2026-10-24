import { contextTokens, type Event, type ModelUsage } from '@dltech/atlas-core'
import type { ModelOption } from '@dltech/atlas-ui/ai/model-selector'

export type ContextUsage = { used: number; limit: number }

export function contextUsageOf(args: {
  reported: ModelUsage | null
  events: readonly Event[]
  selectedId: string
  models: readonly ModelOption[]
}): ContextUsage | null {
  const limit = args.models.find((model) => model.id === args.selectedId)?.contextTokens
  if (limit === undefined || limit <= 0) return null
  return {
    used: contextTokens({ reported: args.reported, events: args.events }),
    limit,
  }
}
