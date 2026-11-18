import { EDefinitionOrigin, resolveShadowing } from '@dltech/atlas-core'
import { ESkillCatalogueOrigin, type SkillCatalogueEntry } from '@dltech/atlas-wire'

type CatalogueOrigin = EDefinitionOrigin.BuiltIn | EDefinitionOrigin.User

export type OriginatedSkill = { origin: CatalogueOrigin; entry: SkillCatalogueEntry }

const WIRE_ORIGINS: Readonly<Record<CatalogueOrigin, ESkillCatalogueOrigin>> = {
  [EDefinitionOrigin.BuiltIn]: ESkillCatalogueOrigin.BuiltIn,
  [EDefinitionOrigin.User]: ESkillCatalogueOrigin.User,
}

export const originated = (args: {
  origin: CatalogueOrigin
  spec: SkillCatalogueEntry
}): OriginatedSkill => ({
  origin: args.origin,
  entry: { ...args.spec, origin: WIRE_ORIGINS[args.origin] },
})

export const mergeSkills = (skills: readonly OriginatedSkill[]): SkillCatalogueEntry[] =>
  resolveShadowing({ definitions: skills, nameOf: (skill) => skill.entry.name }).map(
    (skill) => skill.entry,
  )
