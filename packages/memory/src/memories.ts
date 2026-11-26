import { isUniqueViolation, type Db, type Row, type Tx } from '@dltech/atlas-db'
import {
  MAX_MEMORY_BODY_CHARS,
  MEMORY_EDIT_AMBIGUOUS_CODE,
  MEMORY_EDIT_NO_MATCH_CODE,
  memoryEntrySchema,
  memorySummarySchema,
} from '@dltech/atlas-core'
import type { MemoryEntry, MemorySummary } from '@dltech/atlas-core'

import {
  MemoryEditRefusedError,
  MemoryInvalidError,
  MemoryNotFoundError,
  MemoryStaleRevisionError,
} from './errors'

export type MemoryScope = 'global' | 'group' | 'project'

export type MemoryKind = 'user' | 'feedback' | 'project' | 'reference'

export type MemoryKey = {
  userId: string
  scope: MemoryScope
  project?: string | null | undefined
  groupId?: string | null | undefined
  name: string
}

type Handle = Db | Tx

type StoredKey = {
  userId: string
  scope: MemoryScope
  project: string
  groupId: string
  name: string
}

type MemoryFields = { description: string; type: string; body: string }

type OwnerKey = { scope: MemoryScope; project: string; groupId: string }

function ownerKeyOf(args: MemoryKey): OwnerKey {
  if (args.project === null) throw new MemoryInvalidError('a project must be a string when given')
  if (args.groupId === null) throw new MemoryInvalidError('a group must be a string when given')
  if (args.scope === 'global') {
    if (args.project !== undefined || args.groupId !== undefined) {
      throw new MemoryInvalidError('a global memory has no project and no group')
    }
    return { scope: args.scope, project: '', groupId: '' }
  }
  if (args.scope === 'group') {
    if (args.groupId === undefined)
      throw new MemoryInvalidError('a group-scope memory needs a group')
    if (args.project !== undefined) throw new MemoryInvalidError('a group memory has no project')
    return { scope: args.scope, project: '', groupId: args.groupId }
  }
  if (args.project === undefined) {
    throw new MemoryInvalidError('a project-scope memory needs a project')
  }
  if (args.groupId !== undefined) throw new MemoryInvalidError('a project memory has no group')
  return { scope: args.scope, project: args.project, groupId: '' }
}

function storedKeyOf(args: MemoryKey): StoredKey {
  return { userId: args.userId, ...ownerKeyOf(args), name: args.name }
}

const bumpRevisionStatement = (args: { handle: Handle; key: StoredKey; fields: MemoryFields }) =>
  args.handle.raw
    .sql`UPDATE "Memory" SET description = ${args.fields.description}, type = ${args.fields.type}, body = ${args.fields.body}, revision = revision + 1, "updatedAt" = now() WHERE "userId" = ${args.key.userId} AND scope = ${args.key.scope} AND project = ${args.key.project} AND "groupId" = ${args.key.groupId} AND name = ${args.key.name} RETURNING id`
    .returnsRow({ id: 'pg/text@1' })
    .build()

const guardedBodyStatement = (args: {
  handle: Handle
  id: string
  userId: string
  revision: number
  body: string
}) =>
  args.handle.raw
    .sql`UPDATE "Memory" SET body = ${args.body}, revision = revision + 1, "updatedAt" = now() WHERE id = ${args.id} AND "userId" = ${args.userId} AND revision = ${args.revision} RETURNING id`
    .returnsRow({ id: 'pg/text@1' })
    .build()

const firstOf = ({ handle, key }: { handle: Handle; key: StoredKey }) =>
  handle.orm.public.Memory.first({
    userId: key.userId,
    scope: key.scope,
    project: key.project,
    groupId: key.groupId,
    name: key.name,
  })

function toSummary(row: Row<'Memory'>): MemorySummary {
  return memorySummarySchema.parse({
    scope: row.scope,
    project: row.project === '' ? null : row.project,
    groupId: row.groupId === '' ? null : row.groupId,
    name: row.name,
    description: row.description,
    type: row.type,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  })
}

function toEntry(row: Row<'Memory'>): MemoryEntry {
  return memoryEntrySchema.parse({ ...toSummary(row), body: row.body })
}

function matchStartsOf(args: { text: string; needle: string }): {
  first: number
  another: boolean
} {
  const first = args.text.indexOf(args.needle)
  return { first, another: first >= 0 && args.text.indexOf(args.needle, first + 1) >= 0 }
}

function replaceOnce(args: { text: string; old: string; replacement: string }): string {
  const at = args.text.indexOf(args.old)
  return args.text.slice(0, at) + args.replacement + args.text.slice(at + args.old.length)
}

const bumpOrCreate = async (args: {
  db: Db
  key: StoredKey
  fields: MemoryFields
  retries: number
}): Promise<Row<'Memory'>> => {
  const bumped = await args.db.query(
    bumpRevisionStatement({ handle: args.db, key: args.key, fields: args.fields }),
  )
  if (bumped.length === 0) {
    try {
      return await args.db.orm.public.Memory.create({ ...args.key, ...args.fields })
    } catch (error) {
      if (args.retries === 0 || !isUniqueViolation(error)) throw error
      return bumpOrCreate({ ...args, retries: args.retries - 1 })
    }
  }
  const row = await firstOf({ handle: args.db, key: args.key })
  if (row === null) return bumpOrCreate({ ...args, retries: args.retries })
  return row
}

export async function listMemories(args: {
  db: Db
  userId: string
  project?: string | undefined
  groupId?: string | undefined
}): Promise<MemorySummary[]> {
  const projects = args.project === undefined ? [''] : ['', args.project]
  const groups = args.groupId === undefined ? [''] : ['', args.groupId]
  const rows = await args.db.orm.public.Memory.where({ userId: args.userId })
    .where((memory) => memory.project.in(projects))
    .where((memory) => memory.groupId.in(groups))
    .orderBy((memory) => memory.updatedAt.desc())
    .all()
  return rows.map((row) => toSummary(row))
}

export async function listAllMemories(args: { db: Db; userId: string }): Promise<MemorySummary[]> {
  const rows = await args.db.orm.public.Memory.where({ userId: args.userId })
    .orderBy((memory) => memory.updatedAt.desc())
    .all()
  return rows.map((row) => toSummary(row))
}

export async function getMemory(args: { db: Db } & MemoryKey): Promise<MemoryEntry> {
  const row = await firstOf({ handle: args.db, key: storedKeyOf(args) })
  if (row === null) throw new MemoryNotFoundError()
  return toEntry(row)
}

export async function putMemory(
  args: { db: Db } & MemoryKey & { description: string; type: MemoryKind; body: string },
): Promise<MemorySummary> {
  const key = storedKeyOf(args)
  const fields = { description: args.description, type: args.type, body: args.body }
  const row = await bumpOrCreate({ db: args.db, key, fields, retries: 1 })
  return toSummary(row)
}

export async function editMemory(
  args: { db: Db } & MemoryKey & { old: string; replacement: string; revision: number },
): Promise<MemorySummary> {
  const key = storedKeyOf(args)
  return args.db.transaction(async (tx) => {
    const row = await firstOf({ handle: tx, key })
    if (row === null) throw new MemoryNotFoundError()
    if (row.revision !== args.revision) {
      throw new MemoryStaleRevisionError({ expected: args.revision, current: row.revision })
    }
    const matches = matchStartsOf({ text: row.body, needle: args.old })
    if (matches.first < 0) {
      throw new MemoryEditRefusedError({
        message: 'the text to replace does not occur in the memory',
        code: MEMORY_EDIT_NO_MATCH_CODE,
      })
    }
    if (matches.another) {
      throw new MemoryEditRefusedError({
        message: 'the text to replace occurs more than once; include more surrounding text',
        code: MEMORY_EDIT_AMBIGUOUS_CODE,
      })
    }
    const body = replaceOnce({ text: row.body, old: args.old, replacement: args.replacement })
    if (body.length > MAX_MEMORY_BODY_CHARS) {
      throw new MemoryInvalidError(`a memory body is at most ${MAX_MEMORY_BODY_CHARS} characters`)
    }
    const updated = await tx.query(
      guardedBodyStatement({
        handle: tx,
        id: row.id,
        userId: key.userId,
        revision: row.revision,
        body,
      }),
    )
    const fresh = await firstOf({ handle: tx, key })
    if (fresh === null) throw new MemoryNotFoundError()
    if (updated.length === 0) {
      throw new MemoryStaleRevisionError({ expected: args.revision, current: fresh.revision })
    }
    return toSummary(fresh)
  })
}

export async function removeMemory(args: { db: Db } & MemoryKey): Promise<void> {
  const key = storedKeyOf(args)
  const count = await args.db.orm.public.Memory.where({
    userId: key.userId,
    scope: key.scope,
    project: key.project,
    groupId: key.groupId,
    name: key.name,
  }).deleteAndCount()
  if (count === 0) throw new MemoryNotFoundError()
}
