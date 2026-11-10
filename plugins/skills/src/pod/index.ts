import { CONTEXT_WINDOW_WHEN_THE_MODEL_IS_UNKNOWN } from '@dltech/atlas-core'
import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { skillsCatalogueHook, skillsListingHook, type SkillsPodOptions } from './hooks'
import type { CloudSkillSource } from './port'
import { SkillTool } from './skill-tool'
import { stateFor } from './state'

export type { CloudSkillEntry, CloudSkillSource, SkillScopeName } from './port'
export { REPO_SKILL_ROOTS } from './repo-source'
export { SKILL_LISTING_HEADING } from './listing'

export const SKILL_TOOLS = ['skill'] as const

export const skillsPodOf = (args: {
  cloud: CloudSkillSource
  contextWindowTokens?: number
}): PodSlot => {
  const options: SkillsPodOptions = {
    cloud: args.cloud,
    contextWindowTokens: args.contextWindowTokens ?? CONTEXT_WINDOW_WHEN_THE_MODEL_IS_UNKNOWN,
  }
  return {
    ...EMPTY_POD,
    tools: (ctx) => [new SkillTool(ctx, stateFor(ctx), options)],
    hooks: (ctx) => {
      const state = stateFor(ctx)
      return {
        beforeTurn: [skillsCatalogueHook({ ctx, state, options })],
        beforeStep: [skillsListingHook({ ctx, state, options })],
      }
    },
    prompts: [],
    commands: new Map(),
  }
}
