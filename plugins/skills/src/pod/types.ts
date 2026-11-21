import type { ESkillOrigin, SkillWarning } from '../core'
import type { BuiltInFile } from './builtin-files'
import type { SkillScopeName } from './port'

export type RepoCatalogueSkill = {
  name: string
  description: string
  whenToUse: string | undefined
  userInvocable: boolean
  modelInvocable: boolean
  argumentHint: string | undefined
  origin: ESkillOrigin.Repo
  directory: string
  entryPath: string
  warnings: readonly SkillWarning[]
}

export type CloudCatalogueSkill = {
  name: string
  description: string
  whenToUse: string | undefined
  userInvocable: boolean
  modelInvocable: boolean
  argumentHint: string | undefined
  origin: ESkillOrigin.CloudUser | ESkillOrigin.CloudProject
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
  origin: ESkillOrigin.BuiltIn
  directory: null
  text: string
  files: readonly BuiltInFile[]
  warnings: readonly SkillWarning[]
}

export type CatalogueSkill = RepoCatalogueSkill | CloudCatalogueSkill | BuiltInCatalogueSkill
