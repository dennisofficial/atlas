import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  ESkillOrigin,
  frontmatterOf,
  resolveSkillShadowing,
  skillFrontmatterOf,
  validateSkill,
} from '../core'
import { BUILT_IN_SKILLS } from './builtin.generated'
import type { CloudSkillSource, CloudSkillText } from './port'
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
      files: builtIn.files,
      warnings: validateSkill({ frontmatter, directoryName: builtIn.name }),
    }
  })

const frontmatterByKey = (texts: readonly CloudSkillText[]): ReadonlyMap<string, CloudSkillText> =>
  new Map(texts.map((text) => [`${text.scope}:${text.name.trim().toLowerCase()}`, text]))

const cloudSkills = async (cloud: CloudSkillSource): Promise<readonly CloudCatalogueSkill[]> => {
  const texts = frontmatterByKey(
    await cloud.frontmatter().catch((): readonly CloudSkillText[] => []),
  )

  return cloud.entries().map((entry) => {
    const name = entry.name.trim().toLowerCase()
    const text = texts.get(`${entry.scope}:${name}`)
    const parsed =
      text === undefined
        ? undefined
        : skillFrontmatterOf({ fields: frontmatterOf(text.text), fallbackName: name })

    return {
      name,
      description: parsed?.description || entry.description,
      whenToUse: parsed?.whenToUse,
      userInvocable: parsed?.userInvocable ?? true,
      modelInvocable: parsed?.modelInvocable ?? true,
      argumentHint: parsed?.argumentHint,
      origin: entry.scope === 'project' ? ESkillOrigin.CloudProject : ESkillOrigin.CloudUser,
      directory: null,
      scope: entry.scope,
      warnings:
        parsed === undefined ? [] : validateSkill({ frontmatter: parsed, directoryName: name }),
    }
  })
}

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
    ...(await cloudSkills(args.cloud)),
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
