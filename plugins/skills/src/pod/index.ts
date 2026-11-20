import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { skillsCatalogueHook, skillsListingHook, type SkillsPodOptions } from './hooks'
import type { CloudSkillSource, CloudSkillWriter } from './port'
import { SkillTool } from './skill-tool'
import { stateFor } from './state'
import { SkillManageTool } from './write-tool'

export type {
  CloudSkillEntry,
  CloudSkillSource,
  CloudSkillWriter,
  CloudSkillWriteRequest,
  CloudSkillWriteResult,
  SkillScopeName,
} from './port'
export { BUILT_IN_SKILL_NAMES, ESkillWriteLayer } from './write-support'
export { REPO_SKILL_ROOTS } from './repo-source'
export { SKILL_LISTING_HEADING } from './listing'

export const SKILL_TOOLS = ['skill', 'skill_manage'] as const

export const skillsPodOf = (args: {
  cloud: CloudSkillSource
  writes?: CloudSkillWriter | undefined
}): PodSlot => {
  const options: SkillsPodOptions = {
    cloud: args.cloud,
    writes: args.writes,
  }
  return {
    ...EMPTY_POD,
    tools: (ctx) => {
      const state = stateFor(ctx)
      return [new SkillTool(ctx, state, options), new SkillManageTool(ctx, state, options)]
    },
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
