import { createHash } from 'node:crypto'

import { SKILL_NAME_MAX_LENGTH } from '@dltech/atlas-core'
import { isUniqueViolation, type Db } from '@dltech/atlas-db'

import type { SkillOwner, SkillScopeName } from './skill-body'

export type SkillRevision = { revision: number; hash: string }

export type SkillWriteOutcome =
  | { ok: true; revision: number }
  | { ok: false; reason: string; current: SkillRevision | null }

export type SkillWriteRequest = {
  scope: SkillScopeName
  name: string
  path: string
  body: string
  description: string | null
  baseRevision: number | null
}

export type SkillWriter = {
  write(request: SkillWriteRequest): Promise<SkillWriteOutcome>
  remove(request: { scope: SkillScopeName; name: string }): Promise<SkillWriteOutcome>
}

const ENTRY_PATH = 'SKILL.md'

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

const TEXT_EXTENSIONS: readonly string[] = [
  'md',
  'markdown',
  'txt',
  'yaml',
  'yml',
  'json',
  'toml',
  'csv',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'sh',
  'sql',
  'html',
  'css',
]

const ownerWhere = (args: { owner: SkillOwner; scope: SkillScopeName }): Record<string, string> =>
  args.scope === 'project' ? { projectId: args.owner.projectId } : { userId: args.owner.userId }

const hashOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const isTextPath = (path: string): boolean =>
  TEXT_EXTENSIONS.includes(path.slice(path.lastIndexOf('.') + 1).toLowerCase())

const pathProblem = (path: string): string | undefined => {
  if (path === '' || path.length > 500) return 'a path must be 1 to 500 characters long'
  if (path.startsWith('/')) return 'a path must be relative to the skill'
  if (path.includes('\\') || path.includes('\0')) return 'a path must not hold a backslash or a NUL'
  const bad = path.split('/').find((part) => part === '' || part === '.' || part === '..')
  return bad === undefined
    ? undefined
    : `a path must not hold an empty, "." or ".." segment: ${path}`
}

const refusal = (args: { reason: string; current: SkillRevision | null }): SkillWriteOutcome => ({
  ok: false,
  reason: args.reason,
  current: args.current,
})

const rowOf = async (args: {
  db: Db
  owner: SkillOwner
  scope: SkillScopeName
  name: string
}): Promise<{ id: string; name: string; description: string } | null> => {
  const row = await args.db.orm.public.Skill.first({
    ...ownerWhere({ owner: args.owner, scope: args.scope }),
    name: args.name,
  })
  return row === null || row === undefined ? null : row
}

const fileOf = async (args: {
  db: Db
  skillId: string
  path: string
}): Promise<SkillRevision | null> => {
  const row = await args.db.orm.public.SkillFile.first({
    skillId: args.skillId,
    path: args.path,
  })
  return row === null || row === undefined
    ? null
    : { revision: row.revision, hash: row.contentHash }
}

const createSkill = async (args: {
  db: Db
  owner: SkillOwner
  scope: SkillScopeName
  name: string
  description: string
}): Promise<string> => {
  const where = ownerWhere({ owner: args.owner, scope: args.scope })
  try {
    const created = await args.db.orm.public.Skill.create({
      ...where,
      name: args.name,
      description: args.description,
    })
    return created.id
  } catch (failure) {
    if (!isUniqueViolation(failure)) throw failure
    const raced = await rowOf({
      db: args.db,
      owner: args.owner,
      scope: args.scope,
      name: args.name,
    })
    if (raced === null) throw failure
    return raced.id
  }
}

const skillIdFor = async (args: {
  db: Db
  owner: SkillOwner
  scope: SkillScopeName
  name: string
  description: string
}): Promise<string> => {
  const existing = await rowOf(args)
  if (existing !== null) return existing.id
  return await createSkill(args)
}

const storeFile = async (args: {
  db: Db
  skillId: string
  request: SkillWriteRequest
  baseRevision: number
}): Promise<SkillWriteOutcome> => {
  const bytes = new Uint8Array(Buffer.from(args.request.body, 'utf8'))
  const data = {
    contentHash: hashOf(bytes),
    content: bytes,
    isText: isTextPath(args.request.path),
    size: bytes.byteLength,
  }
  if (args.baseRevision === 0) {
    try {
      await args.db.orm.public.SkillFile.create({
        skillId: args.skillId,
        path: args.request.path,
        revision: 1,
        ...data,
      })
    } catch (failure) {
      if (!isUniqueViolation(failure)) throw failure
      return refusal({
        reason: `the ${args.request.name} skill gained a ${args.request.path} under this install`,
        current: await fileOf({
          db: args.db,
          skillId: args.skillId,
          path: args.request.path,
        }),
      })
    }
  } else {
    const count = await args.db.orm.public.SkillFile.where({
      skillId: args.skillId,
      path: args.request.path,
      revision: args.baseRevision,
    }).updateAndCount({ ...data, revision: args.baseRevision + 1 })
    if (count === 0)
      return refusal({
        reason: `the ${args.request.name} skill changed under this edit`,
        current: await fileOf({
          db: args.db,
          skillId: args.skillId,
          path: args.request.path,
        }),
      })
  }
  return { ok: true, revision: args.baseRevision + 1 }
}

const writeSkill = async (args: {
  db: Db
  owner: SkillOwner
  request: SkillWriteRequest
}): Promise<SkillWriteOutcome> => {
  const { request } = args
  const pathProblemOf = pathProblem(request.path)
  if (pathProblemOf !== undefined) return refusal({ reason: pathProblemOf, current: null })

  const row = await rowOf({
    db: args.db,
    owner: args.owner,
    scope: request.scope,
    name: request.name,
  })
  const current =
    row === null ? null : await fileOf({ db: args.db, skillId: row.id, path: request.path })
  const baseRevision = request.baseRevision ?? -1

  if (row !== null && current === null && baseRevision !== 0)
    return refusal({
      reason: `the ${request.name} skill has no ${request.path} yet`,
      current: null,
    })
  if (current !== null && current.revision !== baseRevision)
    return refusal({
      reason: `the ${request.name} skill changed since baseRevision ${baseRevision}`,
      current,
    })

  const skillId = await skillIdFor({
    db: args.db,
    owner: args.owner,
    scope: request.scope,
    name: request.name,
    description: request.description ?? '',
  })
  const stored = await storeFile({ db: args.db, skillId, request, baseRevision })
  if (!stored.ok) return stored

  if (request.description !== null)
    await args.db.orm.public.Skill.where({ id: skillId }).update({
      description: request.description,
      updatedAt: new Date(),
    })
  return stored
}

const removeSkill = async (args: {
  db: Db
  owner: SkillOwner
  scope: SkillScopeName
  name: string
}): Promise<SkillWriteOutcome> => {
  const row = await rowOf({
    db: args.db,
    owner: args.owner,
    scope: args.scope,
    name: args.name,
  })
  if (row === null)
    return refusal({ reason: `no ${args.scope} skill is named ${args.name}`, current: null })

  await args.db.orm.public.SkillFile.where({ skillId: row.id }).deleteAndCount()
  await args.db.orm.public.Skill.where({ id: row.id }).delete()
  return { ok: true, revision: 0 }
}

export const skillWriterOf = (args: {
  db: Db
  owner: SkillOwner
  builtInNames: readonly string[]
}): SkillWriter => {
  const assertWritable = (name: string): SkillWriteOutcome | undefined => {
    if (!NAME_PATTERN.test(name) || name.length > SKILL_NAME_MAX_LENGTH)
      return refusal({
        reason: `a skill name must match ${NAME_PATTERN.source} and be at most ${SKILL_NAME_MAX_LENGTH} characters`,
        current: null,
      })
    if (args.builtInNames.includes(name))
      return refusal({
        reason: `the ${name} skill is built in, and a built-in cannot be edited or deleted`,
        current: null,
      })
    return undefined
  }

  return {
    write: async (request) => {
      const refused = assertWritable(request.name)
      if (refused !== undefined) return refused
      return await writeSkill({ db: args.db, owner: args.owner, request })
    },
    remove: async (request) => {
      const refused = assertWritable(request.name)
      if (refused !== undefined) return refused
      return await removeSkill({ db: args.db, owner: args.owner, ...request })
    },
  }
}

export { ENTRY_PATH as SKILL_ENTRY_PATH }
