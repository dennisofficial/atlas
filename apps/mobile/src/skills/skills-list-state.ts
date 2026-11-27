import {
  ESkillSortKey,
  ESortDirection,
  formatBytes,
  formatSkillDate,
  matchesSkill,
  orderSkills,
  type SkillScopeTarget,
  type SkillSort,
} from '@dltech/atlas-client/settings'
import { EConfigLayer } from '@dltech/atlas-core'
import { ESkillOrigin, type SkillSummary } from '@dltech/atlas-wire/web'

import type { IChoiceRowOption } from '../settings/choice-row-props'

export enum ESkillSortChoice {
  Default = 'default',
  NameAscending = 'name-ascending',
  NameDescending = 'name-descending',
  UsageDescending = 'usage-descending',
  UsageAscending = 'usage-ascending',
}

export const SKILL_SORT_OPTIONS: readonly IChoiceRowOption<ESkillSortChoice>[] = [
  { value: ESkillSortChoice.Default, label: 'Default order' },
  { value: ESkillSortChoice.NameAscending, label: 'Name A–Z' },
  { value: ESkillSortChoice.NameDescending, label: 'Name Z–A' },
  { value: ESkillSortChoice.UsageDescending, label: 'Most used' },
  { value: ESkillSortChoice.UsageAscending, label: 'Least used' },
]

const SORT_OF_CHOICE: Readonly<Record<ESkillSortChoice, SkillSort>> = {
  [ESkillSortChoice.Default]: null,
  [ESkillSortChoice.NameAscending]: {
    key: ESkillSortKey.Name,
    direction: ESortDirection.Ascending,
  },
  [ESkillSortChoice.NameDescending]: {
    key: ESkillSortKey.Name,
    direction: ESortDirection.Descending,
  },
  [ESkillSortChoice.UsageDescending]: {
    key: ESkillSortKey.Usage,
    direction: ESortDirection.Descending,
  },
  [ESkillSortChoice.UsageAscending]: {
    key: ESkillSortKey.Usage,
    direction: ESortDirection.Ascending,
  },
}

export const sortOfChoice = (choice: ESkillSortChoice): SkillSort => SORT_OF_CHOICE[choice]

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

export const skillIsSelectable = (skill: SkillSummary): boolean =>
  skill.origin !== ESkillOrigin.BuiltIn

export const toggleSelected = ({
  selected,
  name,
}: {
  selected: readonly string[]
  name: string
}): string[] =>
  selected.includes(name) ? selected.filter((value) => value !== name) : [...selected, name]

export const skillMetaLineOf = ({ skill }: { skill: SkillSummary }): string => {
  const usage =
    skill.usage.usedCount30d === 0 ? 'Never used' : `Used ${skill.usage.usedCount30d}× · 30d`
  const files = skill.fileCount === 1 ? '1 file' : `${skill.fileCount} files`
  return `${usage} · ${files} · ${formatBytes(skill.sizeBytes)} · ${formatSkillDate(skill.updatedAt)}`
}

export const deleteConfirmCopyOf = ({ names }: { names: readonly string[] }): string =>
  `${names.join(', ')}. The agent stops loading ${
    names.length === 1 ? 'this skill' : 'these skills'
  } in new threads. This cannot be undone.`

export const deleteConfirmTitleOf = ({ count }: { count: number }): string =>
  `Delete ${count} ${count === 1 ? 'skill' : 'skills'}?`

export const skillDescriptionLabelOf = (skill: SkillSummary): string =>
  skill.description.length === 0 ? 'No description yet.' : skill.description

export const ownSkillLayerOf = (target: SkillScopeTarget): EConfigLayer | null => {
  if (target.projectId !== undefined) return EConfigLayer.Project
  if (target.groupId !== undefined) return EConfigLayer.Group
  return null
}
