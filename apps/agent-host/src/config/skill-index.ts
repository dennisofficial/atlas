import type { Db } from '@dltech/atlas-db'

import type { SkillIndexEntry, SkillScope } from './agent-host-config'

const byName = (left: SkillIndexEntry, right: SkillIndexEntry): number =>
  left.name < right.name ? -1 : left.name > right.name ? 1 : 0

const entriesOf = (args: {
  rows: readonly { name: string; description: string }[]
  scope: SkillScope
}): SkillIndexEntry[] =>
  args.rows.map((row) => ({ name: row.name, description: row.description, scope: args.scope }))

export const skillIndexOf = async (args: {
  db: Db
  userId: string
  projectId: string
}): Promise<SkillIndexEntry[]> => {
  const skills = args.db.orm.public.Skill
  const [user, project] = await Promise.all([
    skills.where({ userId: args.userId }).select('name', 'description').all(),
    skills.where({ projectId: args.projectId }).select('name', 'description').all(),
  ])
  return [
    ...entriesOf({ rows: user, scope: 'user' }),
    ...entriesOf({ rows: project, scope: 'project' }),
  ].sort(byName)
}
