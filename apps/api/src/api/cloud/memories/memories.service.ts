import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  EMemoryScope,
  MAX_MEMORY_BODY_CHARS,
  MEMORY_EDIT_AMBIGUOUS_CODE,
  MEMORY_EDIT_NO_MATCH_CODE,
  MEMORY_STALE_REVISION_CODE,
  memoryEntrySchema,
  memorySummarySchema,
} from '@dltech/atlas-wire'
import type { EMemoryType, MemoryEntry, MemorySummary } from '@dltech/atlas-wire'
import type { MemoryModel } from '../../../db'
import { db } from '../../../db'

interface MemoryKey {
  userId: string
  scope: EMemoryScope
  project?: string | null | undefined
  name: string
}

interface StoredKey {
  userId: string
  scope: EMemoryScope
  project: string
  name: string
}

function storedKeyOf(args: MemoryKey): StoredKey {
  if (args.project === null) throw new BadRequestException('a project must be a string when given')
  if (args.scope === EMemoryScope.Project && args.project === undefined) {
    throw new BadRequestException('a project-scope memory needs a project')
  }
  if (args.scope === EMemoryScope.Global && args.project !== undefined) {
    throw new BadRequestException('a global memory has no project')
  }
  return { userId: args.userId, scope: args.scope, project: args.project ?? '', name: args.name }
}

function uniqueKeyOf(key: StoredKey) {
  return {
    userId_scope_project_name: {
      userId: key.userId,
      scope: key.scope,
      project: key.project,
      name: key.name,
    },
  }
}

function toSummary(row: MemoryModel): MemorySummary {
  return memorySummarySchema.parse({
    scope: row.scope,
    project: row.project === '' ? null : row.project,
    name: row.name,
    description: row.description,
    type: row.type,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  })
}

function toEntry(row: MemoryModel): MemoryEntry {
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

function staleRevision(args: { expected: number; current: number }): ConflictException {
  return new ConflictException({
    message: `memory is at revision ${args.current}, not ${args.expected}; read it again`,
    code: MEMORY_STALE_REVISION_CODE,
  })
}

@Injectable()
export class MemoriesService {
  async list(args: { userId: string; project?: string | undefined }): Promise<MemorySummary[]> {
    const rows = await db.memory.findMany({
      where: {
        userId: args.userId,
        project: { in: args.project === undefined ? [''] : ['', args.project] },
      },
      orderBy: { updatedAt: 'desc' },
    })
    return rows.map((row) => toSummary(row))
  }

  async listAll(args: { userId: string }): Promise<MemorySummary[]> {
    const rows = await db.memory.findMany({
      where: { userId: args.userId },
      orderBy: { updatedAt: 'desc' },
    })
    return rows.map((row) => toSummary(row))
  }

  async get(args: MemoryKey): Promise<MemoryEntry> {
    const row = await db.memory.findUnique({ where: uniqueKeyOf(storedKeyOf(args)) })
    if (row === null) throw new NotFoundException('no such memory')
    return toEntry(row)
  }

  async put(
    args: MemoryKey & { description: string; type: EMemoryType; body: string },
  ): Promise<MemorySummary> {
    const key = storedKeyOf(args)
    const fields = { description: args.description, type: args.type, body: args.body }
    const row = await db.memory.upsert({
      where: uniqueKeyOf(key),
      create: { ...key, ...fields },
      update: { ...fields, revision: { increment: 1 } },
    })
    return toSummary(row)
  }

  async edit(
    args: MemoryKey & { old: string; replacement: string; revision: number },
  ): Promise<MemorySummary> {
    const key = storedKeyOf(args)
    return db.$transaction(async (tx) => {
      const row = await tx.memory.findUnique({ where: uniqueKeyOf(key) })
      if (row === null) throw new NotFoundException('no such memory')
      if (row.revision !== args.revision) {
        throw staleRevision({ expected: args.revision, current: row.revision })
      }
      const matches = matchStartsOf({ text: row.body, needle: args.old })
      if (matches.first < 0) {
        throw new UnprocessableEntityException({
          message: 'the text to replace does not occur in the memory',
          code: MEMORY_EDIT_NO_MATCH_CODE,
        })
      }
      if (matches.another) {
        throw new UnprocessableEntityException({
          message: 'the text to replace occurs more than once; include more surrounding text',
          code: MEMORY_EDIT_AMBIGUOUS_CODE,
        })
      }
      const body = replaceOnce({ text: row.body, old: args.old, replacement: args.replacement })
      if (body.length > MAX_MEMORY_BODY_CHARS) {
        throw new BadRequestException(
          `a memory body is at most ${MAX_MEMORY_BODY_CHARS} characters`,
        )
      }
      const updated = await tx.memory.updateMany({
        where: { id: row.id, userId: key.userId, revision: row.revision },
        data: { body, revision: { increment: 1 } },
      })
      const fresh = await tx.memory.findUnique({ where: uniqueKeyOf(key) })
      if (fresh === null) throw new NotFoundException('no such memory')
      if (updated.count === 0)
        throw staleRevision({ expected: args.revision, current: fresh.revision })
      return toSummary(fresh)
    })
  }

  async remove(args: MemoryKey): Promise<void> {
    const { count } = await db.memory.deleteMany({ where: storedKeyOf(args) })
    if (count === 0) throw new NotFoundException('no such memory')
  }
}
