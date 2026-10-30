import { EDefinitionOrigin, resolveShadowing } from '@dltech/atlas-core'
import { ESkillCatalogueOrigin, type SkillCatalogueEntry } from '@dltech/atlas-wire'

export type OriginatedSkill = { origin: EDefinitionOrigin; entry: SkillCatalogueEntry }

const WIRE_ORIGINS: Readonly<Record<EDefinitionOrigin, ESkillCatalogueOrigin>> = {
  [EDefinitionOrigin.BuiltIn]: ESkillCatalogueOrigin.BuiltIn,
  [EDefinitionOrigin.User]: ESkillCatalogueOrigin.User,
  [EDefinitionOrigin.Project]: ESkillCatalogueOrigin.Project,
}

export const originated = (args: {
  origin: EDefinitionOrigin
  spec: SkillCatalogueEntry
}): OriginatedSkill => ({
  origin: args.origin,
  entry: { ...args.spec, origin: WIRE_ORIGINS[args.origin] },
})

export const mergeSkills = (skills: readonly OriginatedSkill[]): SkillCatalogueEntry[] =>
  resolveShadowing({ definitions: skills, nameOf: (skill) => skill.entry.name }).map(
    (skill) => skill.entry,
  )
