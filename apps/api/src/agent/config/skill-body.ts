import type { Db } from '@dltech/atlas-db'

export type SkillOwner = { userId: string; projectId: string | null }

export type SkillScopeName = 'user' | 'project'

const ENTRY_PATH = 'SKILL.md'

const likeLiteralOf = (path: string): string => path.replace(/[\\%_]/g, '\\$&')

const ownerWhere = (args: {
  owner: SkillOwner
  scope: SkillScopeName
}): Record<string, string> | null => {
  if (args.scope === 'user') return { userId: args.owner.userId }
  return args.owner.projectId === null ? null : { projectId: args.owner.projectId }
}

export type SkillBody = { text: string; revision: number; hash: string }

const fileOf = async (args: {
  db: Db
  skillId: string
  path: string
}): Promise<{ content: Uint8Array; revision: number; contentHash: string } | null> => {
  const files = await args.db.orm.public.SkillFile.where((file) => file.skillId.eq(args.skillId))
    .where((file) => file.path.ilike(likeLiteralOf(args.path)))
    .select('path', 'content', 'revision', 'contentHash')
    .all()
  const wanted = args.path.toLowerCase()
  return files.find((file) => file.path.toLowerCase() === wanted) ?? null
}

export const skillTextOf = async (args: {
  db: Db
  owner: SkillOwner
  scope: SkillScopeName
  name: string
  path?: string | undefined
}): Promise<SkillBody | null> => {
  const where = ownerWhere({ owner: args.owner, scope: args.scope })
  if (where === null) return null
  const skill = await args.db.orm.public.Skill.first({
    ...where,
    name: args.name,
  })
  if (skill === null || skill === undefined) return null

  const found = await fileOf({
    db: args.db,
    skillId: skill.id,
    path: args.path ?? ENTRY_PATH,
  })
  if (found === null) return null
  return {
    text: Buffer.from(found.content).toString('utf8'),
    revision: found.revision,
    hash: found.contentHash,
  }
}

export type CloudSkillText = { scope: SkillScopeName; name: string; text: string }

const skillRowsOf = async (args: {
  db: Db
  owner: SkillOwner
}): Promise<readonly { id: string; name: string; scope: SkillScopeName }[]> => {
  const skills = args.db.orm.public.Skill
  const user = await skills.where({ userId: args.owner.userId }).select('id', 'name').all()
  const project =
    args.owner.projectId === null
      ? []
      : await skills.where({ projectId: args.owner.projectId }).select('id', 'name').all()
  return [
    ...user.map((row) => ({ id: row.id, name: row.name, scope: 'user' as const })),
    ...project.map((row) => ({ id: row.id, name: row.name, scope: 'project' as const })),
  ]
}

const entryTextsOf = async (args: {
  db: Db
  skillIds: readonly string[]
}): Promise<Map<string, string>> => {
  const files = await args.db.orm.public.SkillFile.where((file) => file.skillId.in(args.skillIds))
    .where((file) => file.path.eq(ENTRY_PATH))
    .select('skillId', 'content')
    .all()
  const texts = new Map<string, string>()
  for (const file of files) {
    if (texts.has(file.skillId)) continue
    texts.set(file.skillId, Buffer.from(file.content).toString('utf8'))
  }
  return texts
}

export const skillFrontmattersOf = async (args: {
  db: Db
  owner: SkillOwner
}): Promise<readonly CloudSkillText[]> => {
  const rows = await skillRowsOf(args)
  if (rows.length === 0) return []
  const texts = await entryTextsOf({ db: args.db, skillIds: rows.map((row) => row.id) })
  return rows.flatMap((row): CloudSkillText[] => {
    const text = texts.get(row.id)
    return text === undefined ? [] : [{ scope: row.scope, name: row.name, text }]
  })
}
