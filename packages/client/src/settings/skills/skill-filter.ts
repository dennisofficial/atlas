import type { SkillSummary } from '@dltech/atlas-wire/web'

export const matchesSkill = ({ skill, query }: { skill: SkillSummary; query: string }): boolean => {
  const needle = query.trim().toLowerCase()
  return (
    needle.length === 0 ||
    skill.name.toLowerCase().includes(needle) ||
    skill.description.toLowerCase().includes(needle)
  )
}
