import type { SkillSummary } from '@dltech/atlas-wire/web'

export enum ESkillSortKey {
  Name = 'name',
  Usage = 'usage',
}

export enum ESortDirection {
  Ascending = 'ascending',
  Descending = 'descending',
}

export type SkillSort = { key: ESkillSortKey; direction: ESortDirection } | null

const CYCLE: Record<ESortDirection, ESortDirection | null> = {
  [ESortDirection.Ascending]: ESortDirection.Descending,
  [ESortDirection.Descending]: null,
}

export function cycleSkillSort({
  current,
  key,
}: {
  current: SkillSort
  key: ESkillSortKey
}): SkillSort {
  if (current === null || current.key !== key) {
    return { key, direction: ESortDirection.Ascending }
  }
  const next = CYCLE[current.direction]
  return next === null ? null : { key, direction: next }
}

export function ariaSortOf({
  sort,
  key,
}: {
  sort: SkillSort
  key: ESkillSortKey
}): 'ascending' | 'descending' | 'none' {
  if (sort === null || sort.key !== key) return 'none'
  return sort.direction
}

export function orderSkills({
  skills,
  sort,
}: {
  skills: readonly SkillSummary[]
  sort: SkillSort
}): SkillSummary[] {
  const ordered = [...skills]
  if (sort === null) return ordered
  const sign = sort.direction === ESortDirection.Ascending ? 1 : -1
  if (sort.key === ESkillSortKey.Name) {
    return ordered.sort((a, b) => a.name.localeCompare(b.name) * sign)
  }
  return ordered.sort((a, b) => (a.usage.usedCount30d - b.usage.usedCount30d) * sign)
}
