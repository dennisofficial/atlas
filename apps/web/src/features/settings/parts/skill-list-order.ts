import type { SkillSummary } from '@dltech/atlas-wire/web'

export enum ESkillSort {
  Name = 'name',
  Usage = 'usage',
}

export function orderSkills({
  skills,
  sort,
}: {
  skills: readonly SkillSummary[]
  sort: ESkillSort
}): SkillSummary[] {
  if (sort === ESkillSort.Name) return [...skills].sort((a, b) => a.name.localeCompare(b.name))
  return [...skills].sort((a, b) => a.usage.usedCount30d - b.usage.usedCount30d)
}
