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
  projectId: string | null
}): Promise<SkillIndexEntry[]> => {
  const skills = args.db.orm.public.Skill
  const user = await skills.where({ userId: args.userId }).select('name', 'description').all()
  if (args.projectId === null) return entriesOf({ rows: user, scope: 'user' }).sort(byName)
  const project = await skills
    .where({ projectId: args.projectId })
    .select('name', 'description')
    .all()
  return [
    ...entriesOf({ rows: user, scope: 'user' }),
    ...entriesOf({ rows: project, scope: 'project' }),
  ].sort(byName)
}
