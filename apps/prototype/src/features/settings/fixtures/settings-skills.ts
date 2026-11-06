export type SkillRow = {
  name: string
  description: string
  updatedAt: string
}

export const SKILL_ROWS: SkillRow[] = [
  {
    name: 'code-review',
    description: 'Review a diff against the repo standards before it merges.',
    updatedAt: 'Nov 3, 2026',
  },
  {
    name: 'commit',
    description: 'Stage the current work and write a conventional commit message.',
    updatedAt: 'Oct 28, 2026',
  },
  {
    name: 'tdd',
    description: 'Build features and fix bugs test-first.',
    updatedAt: 'Oct 12, 2026',
  },
]

export function skillByName(name: string): SkillRow | null {
  return SKILL_ROWS.find((skill) => skill.name === name) ?? null
}
