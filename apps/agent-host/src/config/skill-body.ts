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

export type CloudSkillText = { scope: SkillScopeName; name: string; text: string }

const skillRowsOf = async (args: {
  db: Db
  owner: SkillOwner
}): Promise<readonly { id: string; name: string; scope: SkillScopeName }[]> => {
  const skills = args.db.orm.public.Skill
  const [user, project] = await Promise.all([
    skills.where({ userId: args.owner.userId }).select('id', 'name').all(),
    skills.where({ projectId: args.owner.projectId }).select('id', 'name').all(),
  ])
  return [
    ...user.map((row) => ({ id: row.id, name: row.name, scope: 'user' as const })),
    ...project.map((row) => ({ id: row.id, name: row.name, scope: 'project' as const })),
  ]
}

export const skillFrontmattersOf = async (args: {
  db: Db
  owner: SkillOwner
}): Promise<readonly CloudSkillText[]> => {
  const rows = await skillRowsOf(args)
  const texts = await Promise.all(
    rows.map(async (row): Promise<CloudSkillText | undefined> => {
      const files = await args.db.orm.public.SkillFile.where({ skillId: row.id }).all()
      const entry = files.find((file) => file.path.toLowerCase() === ENTRY_PATH.toLowerCase())
      if (entry === undefined) return undefined
      return {
        scope: row.scope,
        name: row.name,
        text: Buffer.from(entry.content).toString('utf8'),
      }
    }),
  )
  return texts.filter((one): one is CloudSkillText => one !== undefined)
}
