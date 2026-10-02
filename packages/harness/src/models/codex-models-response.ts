import {
  CONTEXT_WINDOW_UNMEASURED,
  EEffort,
  EFFORT_LADDER,
  EImageTier,
  type EffortMap,
  type ModelCard,
} from '@dltech/atlas-core'
import { z } from 'zod'

// openai/codex codex-rs/protocol/src/openai_models.rs `ModelInfo` / `ModelsResponse`. Fields are
// snake_case on the wire. Everything but the slug is tolerated absent so one server-side addition
// or omission cannot empty the picker.
const ReasoningLevelSchema = z.object({
  effort: z.string(),
  description: z.string().optional(),
})

export const ModelInfoSchema = z.object({
  slug: z.string().min(1),
  display_name: z.string().optional(),
  description: z.string().nullish(),
  default_reasoning_level: z.string().nullish(),
  supported_reasoning_levels: z.array(ReasoningLevelSchema).default([]),
  visibility: z.string().default('none'),
  priority: z.number().default(0),
  supported_in_api: z.boolean().optional(),
  minimal_client_version: z.unknown().optional(),
  context_window: z.number().nullish(),
})

export const ModelsResponseSchema = z.object({
  models: z.array(ModelInfoSchema),
})

export type ModelInfo = z.infer<typeof ModelInfoSchema>
export type ModelsResponse = z.infer<typeof ModelsResponseSchema>

export const LISTED_VISIBILITY = 'list'

// codex-rs `ReasoningEffort` spells "no reasoning" as `none`; Atlas's ladder calls the rung `off`.
const RUNG_BY_WIRE: Readonly<Record<string, EEffort>> = {
  ...Object.fromEntries(EFFORT_LADDER.map((effort) => [String(effort), effort])),
  none: EEffort.Off,
}

function toEffortMap(levels: ModelInfo['supported_reasoning_levels']): EffortMap | undefined {
  const map: EffortMap = {}
  for (const level of levels) {
    const rung = RUNG_BY_WIRE[level.effort]
    if (rung === undefined) continue
    map[rung] = level.effort
  }
  return Object.keys(map).length === 0 ? undefined : map
}

function toCard(args: { model: ModelInfo; providerId: string }): ModelCard {
  const effort = toEffortMap(args.model.supported_reasoning_levels)

  return {
    ref: { providerId: args.providerId, modelId: args.model.slug },
    label: args.model.display_name ?? args.model.slug,
    api: 'openai-responses',
    contextWindow: args.model.context_window ?? CONTEXT_WINDOW_UNMEASURED,
    imageTier: EImageTier.Standard,
    ...(effort === undefined ? {} : { effort }),
  }
}

export const hasListedModel = (models: readonly ModelInfo[]): boolean =>
  models.some((model) => model.visibility === LISTED_VISIBILITY)

export function toCodexModelCards(args: {
  models: readonly ModelInfo[]
  providerId: string
}): ModelCard[] {
  return args.models
    .filter((model) => model.visibility === LISTED_VISIBILITY)
    .sort((a, b) => a.priority - b.priority)
    .map((model) => toCard({ model, providerId: args.providerId }))
}
