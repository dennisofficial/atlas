import type { ESkillOrigin, SkillWarning } from '../core'
import type { SkillScopeName } from './port'

export type RepoCatalogueSkill = {
  name: string
  description: string
  whenToUse: string | undefined
  userInvocable: boolean
  modelInvocable: boolean
  argumentHint: string | undefined
  origin: ESkillOrigin
  directory: string
  entryPath: string
  warnings: readonly SkillWarning[]
}

export type CloudCatalogueSkill = {
  name: string
  description: string
  whenToUse: undefined
  userInvocable: true
  modelInvocable: true
  argumentHint: undefined
  origin: ESkillOrigin
  directory: null
  scope: SkillScopeName
  warnings: readonly SkillWarning[]
}

export type BuiltInCatalogueSkill = {
  name: string
  description: string
  whenToUse: string | undefined
  userInvocable: boolean
  modelInvocable: boolean
  argumentHint: string | undefined
  origin: ESkillOrigin
  directory: null
  text: string
  warnings: readonly SkillWarning[]
}

export type CatalogueSkill = RepoCatalogueSkill | CloudCatalogueSkill | BuiltInCatalogueSkill
