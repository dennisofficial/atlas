import type { Db } from '@dltech/atlas-db'

export type SkillOwner = { userId: string; projectId: string }

export type SkillScopeName = 'user' | 'project'

const ENTRY_PATH = 'SKILL.md'

const ownerWhere = (args: { owner: SkillOwner; scope: SkillScopeName }): Record<string, string> =>
  args.scope === 'project' ? { projectId: args.owner.projectId } : { userId: args.owner.userId }

export const skillTextOf = async (args: {
  db: Db
  owner: SkillOwner
  scope: SkillScopeName
  name: string
  path?: string | undefined
}): Promise<string | null> => {
  const skill = await args.db.orm.public.Skill.first({
    ...ownerWhere({ owner: args.owner, scope: args.scope }),
    name: args.name,
  })
  if (skill === null || skill === undefined) return null

  const files = await args.db.orm.public.SkillFile.where({ skillId: skill.id }).all()
  const wanted = (args.path ?? ENTRY_PATH).toLowerCase()
  const found = files.find((file) => file.path.toLowerCase() === wanted)
  return found === undefined ? null : Buffer.from(found.content).toString('utf8')
}
