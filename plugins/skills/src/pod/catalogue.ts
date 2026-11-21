import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import {
  ESkillOrigin,
  ESkillWarning,
  frontmatterOf,
  resolveSkillShadowing,
  skillFrontmatterOf,
  validateSkill,
  type SkillsChanged,
} from '../core'
import { BUILT_IN_SKILLS } from './builtin.generated'
import type { CloudSkillSource, CloudSkillText } from './port'
import { discoverRepoSkills } from './repo-source'
import type {
  BuiltInCatalogueSkill,
  CatalogueSkill,
  CloudCatalogueSkill,
  RepoCatalogueSkill,
} from './types'

export type ShadowedSkillRow = { name: string; origin: ESkillOrigin; shadowedBy: ESkillOrigin }

export type SkillCatalogue = {
  directory: string
  skills: readonly CatalogueSkill[]
  shadowed: readonly ShadowedSkillRow[]
}

type OptionalSkillField = 'whenToUse' | 'argumentHint'

export type SnapshottedRepoSkill = Omit<RepoCatalogueSkill, OptionalSkillField> & {
  whenToUse?: string | undefined
  argumentHint?: string | undefined
}

export type SnapshottedCloudSkill = Omit<CloudCatalogueSkill, OptionalSkillField> & {
  whenToUse?: string | undefined
  argumentHint?: string | undefined
}

export type SnapshottedBuiltInSkill = { name: string; origin: ESkillOrigin.BuiltIn }

export type SnapshottedSkill =
  | SnapshottedRepoSkill
  | SnapshottedCloudSkill
  | SnapshottedBuiltInSkill

export type SnapshottedCatalogue = {
  directory: string
  skills: readonly SnapshottedSkill[]
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

export const skillsChangedOf = (catalogue: SkillCatalogue): SkillsChanged => ({
  type: 'skills-changed',
  skills: catalogue.skills
    .filter((skill) => skill.userInvocable)
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      argumentHint: skill.argumentHint ?? null,
      origin: skill.origin,
    })),
})

export const SKILL_SCOPE = ['user', 'project'] as const

const warningSchema = z.object({ code: z.enum(ESkillWarning), detail: z.string() })

const skillFields = {
  name: z.string(),
  description: z.string(),
  whenToUse: z.string().optional(),
  userInvocable: z.boolean(),
  modelInvocable: z.boolean(),
  argumentHint: z.string().optional(),
  warnings: z.array(warningSchema),
}

const snapshottedSkillSchema = z.discriminatedUnion('origin', [
  z.object({
    ...skillFields,
    origin: z.literal(ESkillOrigin.Repo),
    directory: z.string(),
    entryPath: z.string(),
  }),
  z.object({
    ...skillFields,
    origin: z.literal(ESkillOrigin.CloudUser),
    directory: z.null(),
    scope: z.enum(SKILL_SCOPE),
  }),
  z.object({
    ...skillFields,
    origin: z.literal(ESkillOrigin.CloudProject),
    directory: z.null(),
    scope: z.enum(SKILL_SCOPE),
  }),
  z.object({ name: z.string(), origin: z.literal(ESkillOrigin.BuiltIn) }),
])

export const snapshottedCatalogueSchema: z.ZodType<SnapshottedCatalogue> = z.object({
  directory: z.string(),
  skills: z.array(snapshottedSkillSchema),
  shadowed: z.array(
    z.object({
      name: z.string(),
      origin: z.enum(ESkillOrigin),
      shadowedBy: z.enum(ESkillOrigin),
    }),
  ),
})

export const snapshottedCatalogueOf = (catalogue: SkillCatalogue): SnapshottedCatalogue => {
  const skills: SnapshottedSkill[] = []
  for (const skill of catalogue.skills) {
    if (skill.origin === ESkillOrigin.BuiltIn) {
      skills.push({ name: skill.name, origin: skill.origin })
      continue
    }
    skills.push(skill)
  }
  return { directory: catalogue.directory, skills, shadowed: catalogue.shadowed }
}

const builtInsByName = (): ReadonlyMap<string, BuiltInCatalogueSkill> =>
  new Map(builtIns().map((skill) => [skill.name, skill]))

export const catalogueOfSnapshot = (snapshot: SnapshottedCatalogue): SkillCatalogue => {
  const builtInByName = builtInsByName()
  const skills: CatalogueSkill[] = []
  for (const skill of snapshot.skills) {
    if (skill.origin !== ESkillOrigin.BuiltIn) {
      skills.push({
        ...skill,
        whenToUse: skill.whenToUse,
        argumentHint: skill.argumentHint,
      })
      continue
    }
    const builtIn = builtInByName.get(skill.name)
    if (builtIn !== undefined) skills.push(builtIn)
  }
  return { directory: snapshot.directory, skills, shadowed: snapshot.shadowed }
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
