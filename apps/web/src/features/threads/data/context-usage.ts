import { contextTokens, lastStepUsage, type Event } from '@dltech/atlas-core'
import type { ModelOption } from '@dltech/atlas-ui/ai/model-selector'

export type ContextUsage = { used: number; limit: number }

export function contextUsageOf(args: {
  events: readonly Event[]
  selectedId: string
  models: readonly ModelOption[]
}): ContextUsage | null {
  const reading = lastStepUsage(args.events)
  const limit =
    reading?.contextWindow ??
    args.models.find((model) => model.id === args.selectedId)?.contextTokens
  if (limit === undefined || limit <= 0) return null
  return { used: contextTokens({ reported: reading, events: args.events }), limit }
}
