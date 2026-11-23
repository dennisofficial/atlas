import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { skillsListingHook } from './hooks'
import { skillsResource, type SkillsPodOptions } from './resources'
import { SkillTool } from './skill-tool'
import { skillsSlashOf } from './slash'
import { SkillManageTool } from './write-tool'

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
export type {
  BuiltInSkillCatalogueEntry,
  BuiltInSkillFileEntry,
} from '../catalogue'
export {
  BUILT_IN_SKILL_CATALOGUE,
  builtInSkillEntry,
  builtInSkillNames,
  builtInSkills,
  isBuiltInSkillName,
} from '../catalogue'
export { BUILT_IN_SKILL_SPECS, type BuiltInSkillSpec } from './builtin-specs'
export { builtInSkillsRoot } from './builtin-skills-root'

export const SKILL_TOOLS = ['skill', 'skill_manage'] as const

export const skillsPodOf = (options: SkillsPodOptions): PodSlot => ({
  ...EMPTY_POD,
  resources: [skillsResource(options)],
  tools: (ctx) => [new SkillTool(ctx, options), new SkillManageTool(ctx, options)],
  hooks: (ctx) => ({ beforeStep: [skillsListingHook({ ctx, options })] }),
  slash: (ctx) => skillsSlashOf({ ctx, options }),
})
