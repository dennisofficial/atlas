import { ESkillOrigin, type SkillSummary } from '@dltech/atlas-wire/web'

import { matchesSkill } from './skill-filter'
import { orderSkills, type SkillSort } from './skill-list-order'

export const skillIsSelectable = (skill: SkillSummary): boolean =>
  skill.origin !== ESkillOrigin.BuiltIn

export const visibleSkillsOf = ({
  skills,
  query,
  sort,
}: {
  skills: readonly SkillSummary[]
  query: string
  sort: SkillSort
}): SkillSummary[] =>
  orderSkills({ skills: skills.filter((skill) => matchesSkill({ skill, query })), sort })

export const liveSelectedOf = ({
  selected,
  visible,
}: {
  selected: readonly string[]
  visible: readonly SkillSummary[]
}): string[] => selected.filter((name) => visible.some((skill) => skill.name === name))
