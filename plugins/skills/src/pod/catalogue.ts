import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  ESkillOrigin,
  frontmatterOf,
  resolveSkillShadowing,
  skillFrontmatterOf,
  validateSkill,
} from '../core'
import { BUILT_IN_SKILLS } from './builtin.generated'
import type { CloudSkillSource } from './port'
import { discoverRepoSkills } from './repo-source'
import type { BuiltInCatalogueSkill, CatalogueSkill, CloudCatalogueSkill } from './types'

export type ShadowedSkillRow = { name: string; origin: ESkillOrigin; shadowedBy: ESkillOrigin }

export type SkillCatalogue = {
  directory: string
  skills: readonly CatalogueSkill[]
  shadowed: readonly ShadowedSkillRow[]
}

const builtIns = (): readonly BuiltInCatalogueSkill[] =>
  BUILT_IN_SKILLS.map((builtIn) => {
    const frontmatter = skillFrontmatterOf({
      fields: frontmatterOf(builtIn.text),
      fallbackName: builtIn.name,
    })
    return {
      name: frontmatter.name,
      description: frontmatter.description,
      whenToUse: frontmatter.whenToUse,
      userInvocable: frontmatter.userInvocable,
      modelInvocable: frontmatter.modelInvocable,
      argumentHint: frontmatter.argumentHint,
      origin: ESkillOrigin.BuiltIn,
      directory: null,
      text: builtIn.text,
      warnings: validateSkill({ frontmatter, directoryName: builtIn.name }),
    }
  })

const cloudSkills = (cloud: CloudSkillSource): readonly CloudCatalogueSkill[] =>
  cloud.entries().map((entry) => ({
    name: entry.name.trim().toLowerCase(),
    description: entry.description,
    whenToUse: undefined,
    userInvocable: true,
    modelInvocable: true,
    argumentHint: undefined,
    origin: entry.scope === 'project' ? ESkillOrigin.CloudProject : ESkillOrigin.CloudUser,
    directory: null,
    scope: entry.scope,
    warnings: [],
  }))

export const buildCatalogue = async (args: {
  ctx: Pick<PluginPodContext, 'call' | 'log'>
  cloud: CloudSkillSource
  directory: string
  signal?: AbortSignal | undefined
}): Promise<SkillCatalogue> => {
  const directory = args.directory
  const repo = await discoverRepoSkills({
    ctx: args.ctx,
    projectDirectory: directory,
    signal: args.signal,
  })
  const resolved = resolveSkillShadowing<CatalogueSkill>([
    ...repo,
    ...cloudSkills(args.cloud),
    ...builtIns(),
  ])
  return {
    directory,
    skills: resolved.kept,
    shadowed: resolved.shadowed.map((row) => ({
      name: row.shadowed.name,
      origin: row.shadowed.origin,
      shadowedBy: row.by.origin,
    })),
  }
}
