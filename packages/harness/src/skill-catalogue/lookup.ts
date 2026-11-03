import type { BuiltInSkillCatalogueEntry } from './catalogue-types'
import { BUILT_IN_SKILL_CATALOGUE } from './catalogue.generated'

const byName = new Map(BUILT_IN_SKILL_CATALOGUE.map((skill) => [skill.name, skill]))

export const builtInSkills = (): readonly BuiltInSkillCatalogueEntry[] => BUILT_IN_SKILL_CATALOGUE

export const builtInSkillNames = (): ReadonlySet<string> => new Set(byName.keys())

export const builtInSkillEntry = (name: string): BuiltInSkillCatalogueEntry | undefined =>
  byName.get(name.toLowerCase())

export const isBuiltInSkillName = (name: string): boolean => byName.has(name.toLowerCase())
