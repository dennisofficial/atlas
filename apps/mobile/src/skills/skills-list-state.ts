import {
  ESkillSortKey,
  ESortDirection,
  formatBytes,
  formatSkillDate,
  type SkillScopeTarget,
  type SkillSort,
  skillUsageViewOf,
} from '@dltech/atlas-client/settings'
import { EConfigLayer } from '@dltech/atlas-core'
import type { SkillSummary } from '@dltech/atlas-wire/web'

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

export const toggleSelected = ({
  selected,
  name,
}: {
  selected: readonly string[]
  name: string
}): string[] =>
  selected.includes(name) ? selected.filter((value) => value !== name) : [...selected, name]

export const skillMetaLineOf = ({ skill, now }: { skill: SkillSummary; now: number }): string => {
  const usage = skillUsageViewOf({ skill, now })
  const parts = [usage.usageLabel]
  if (usage.lastUsedLabel !== null) parts.push(usage.lastUsedLabel)
  parts.push(
    skill.fileCount === 1 ? '1 file' : `${skill.fileCount} files`,
    formatBytes(skill.sizeBytes),
    formatSkillDate(skill.updatedAt),
  )
  return parts.join(', ')
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
