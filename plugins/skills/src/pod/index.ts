import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { skillsListingHook } from './hooks'
import { skillsResource, type SkillsPodOptions } from './resources'
import { SkillTool } from './skill-tool'
import { SkillDeleteTool, SkillEditTool, SkillInstallTool } from './write-tool'

export type {
  CloudSkillEntry,
  CloudSkillSource,
  CloudSkillWriter,
  CloudSkillWriteRequest,
  CloudSkillWriteResult,
  SkillScopeName,
} from './port'
export { SKILLS_RESOURCE, skillsResource, type SkillsPodOptions } from './resources'
export { BUILT_IN_SKILL_NAMES, ESkillWriteLayer } from './write-support'
export { REPO_SKILL_ROOTS } from './repo-source'
export { SKILL_LISTING_HEADING } from './listing'

export const SKILL_TOOLS = ['skill', 'skill_install', 'skill_edit', 'skill_delete'] as const

export const skillsPodOf = (options: SkillsPodOptions): PodSlot => ({
  ...EMPTY_POD,
  resources: [skillsResource(options)],
  tools: (ctx) => [
    new SkillTool(ctx, options),
    new SkillInstallTool(ctx, options),
    new SkillEditTool(ctx, options),
    new SkillDeleteTool(ctx, options),
  ],
  hooks: (ctx) => ({ beforeStep: [skillsListingHook({ ctx, options })] }),
})
