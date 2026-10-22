import { createHash } from 'node:crypto'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { hoisted } from '@dltech/bun-test-shims'
import { Prisma, type PrismaClient } from '../../../generated/prisma/client'
import { UserFilesService } from './user-files.service'

interface UserFileRow {
  id: string
  userId: string
  tree: string
  path: string
  revision: number
  contentHash: string
  content: Uint8Array | null
  tombstonedAt: Date | null
}

type RowKey = { userId: string; tree: string; path: string }
type FindManyArgs = {
  where: { userId: string; tree: string; revision?: { gt: number }; path?: { in: string[] } }
}

const fake = hoisted(() => {
  const rows: UserFileRow[] = []
  const findManyCalls: unknown[] = []
  const state = { createFailure: undefined as unknown }

  const matches = (row: UserFileRow, key: RowKey) =>
    row.userId === key.userId && row.tree === key.tree && row.path === key.path

  const db = {
    userFile: {
      findMany: async (args: FindManyArgs) => {
        findManyCalls.push(args)
        return rows
          .filter((row) => row.userId === args.where.userId && row.tree === args.where.tree)
          .filter((row) => args.where.revision === undefined || row.revision > args.where.revision.gt)
          .filter((row) => args.where.path === undefined || args.where.path.in.includes(row.path))
          .sort((a, b) => a.revision - b.revision)
      },
      findUnique: async (args: { where: { userId_tree_path: RowKey } }) =>
        rows.find((row) => matches(row, args.where.userId_tree_path)) ?? null,
      create: async (args: { data: Omit<UserFileRow, 'id' | 'tombstonedAt'> }) => {
        if (state.createFailure !== undefined) throw state.createFailure
        const row = { ...args.data, id: `uf_${rows.length}`, tombstonedAt: null }
        rows.push(row)
        return row
      },
      updateMany: async (args: {
        where: RowKey & { revision: number }
        data: Partial<UserFileRow>
      }) => {
        const row = rows.find((candidate) => matches(candidate, args.where))
        if (row === undefined || row.revision !== args.where.revision) return { count: 0 }
        Object.assign(row, args.data)
        return { count: 1 }
      },
    },
  }

  return { db, rows, findManyCalls, state }
})

mock.module('../../../db', () => ({ db: fake.db as unknown as PrismaClient }))

const USER_A = 'user-a'
const USER_B = 'user-b'

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex')
const encode = (text: string) => Buffer.from(text).toString('base64')

function putArgs(args: { text: string; baseRevision: number; path?: string; userId?: string }) {
  return {
    userId: args.userId ?? USER_A,
    tree: 'skills',
    path: args.path ?? 'review/SKILL.md',
    content: encode(args.text),
    contentHash: hashOf(args.text),
    baseRevision: args.baseRevision,
  }
}

async function conflictOf(attempt: Promise<unknown>): Promise<ConflictException> {
  const failure = await attempt.then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(failure).toBeInstanceOf(ConflictException)
  return failure as ConflictException
}

describe('UserFilesService', () => {
  let service: UserFilesService

  beforeEach(() => {
    fake.rows.length = 0
    fake.findManyCalls.length = 0
    fake.state.createFailure = undefined
    service = new UserFilesService()
  })

  describe('put', () => {
    it('creates revision 1 when the file is new and baseRevision is 0', async () => {
      expect(await service.put(putArgs({ text: 'one', baseRevision: 0 }))).toEqual({ revision: 1 })

      expect(fake.rows[0]).toMatchObject({ revision: 1, contentHash: hashOf('one') })
      expect(Buffer.from(fake.rows[0]?.content ?? []).toString()).toBe('one')
    })

    it('refuses a create whose baseRevision claims the file already exists', async () => {
      const conflict = await conflictOf(service.put(putArgs({ text: 'one', baseRevision: 3 })))

      expect(conflict.getResponse()).toMatchObject({ currentRevision: 0, contentHash: '' })
      expect(fake.rows).toHaveLength(0)
    })

    it('rejects a stale second writer with the current revision and hash', async () => {
      await service.put(putArgs({ text: 'one', baseRevision: 0 }))
      await service.put(putArgs({ text: 'two', baseRevision: 1 }))

      const conflict = await conflictOf(service.put(putArgs({ text: 'late', baseRevision: 1 })))

      expect(conflict.getResponse()).toMatchObject({
        currentRevision: 2,
        contentHash: hashOf('two'),
      })
      expect(fake.rows[0]?.contentHash).toBe(hashOf('two'))
    })

    it('rejects a create that loses the insert race with the winner state', async () => {
      await service.put(putArgs({ text: 'one', baseRevision: 0 }))
      fake.rows.length = 1
      fake.state.createFailure = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['userId', 'tree', 'path'] },
      })
      vi.spyOn(fake.db.userFile, 'findUnique')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(fake.rows[0] ?? null)

      const conflict = await conflictOf(
        service.put(putArgs({ text: 'racer', baseRevision: 0 })),
      )

      expect(conflict.getResponse()).toMatchObject({ currentRevision: 1 })
    })

    it('bumps the revision, stores the hash and clears a tombstone on a matching base', async () => {
      await service.put(putArgs({ text: 'one', baseRevision: 0 }))
      await service.remove({ userId: USER_A, tree: 'skills', path: 'review/SKILL.md', baseRevision: 1 })

      expect(await service.put(putArgs({ text: 'back', baseRevision: 2 }))).toEqual({ revision: 3 })

      expect(fake.rows[0]).toMatchObject({
        revision: 3,
        contentHash: hashOf('back'),
        tombstonedAt: null,
      })
    })

    it('rejects content that does not match its declared hash', async () => {
      const args = { ...putArgs({ text: 'one', baseRevision: 0 }), contentHash: hashOf('other') }

      await expect(service.put(args)).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('remove', () => {
    const target = { userId: USER_A, tree: 'skills', path: 'review/SKILL.md' }

    it('tombstones the row, clearing content and bumping the revision', async () => {
      await service.put(putArgs({ text: 'one', baseRevision: 0 }))

      expect(await service.remove({ ...target, baseRevision: 1 })).toEqual({ revision: 2 })

      expect(fake.rows).toHaveLength(1)
      expect(fake.rows[0]).toMatchObject({ revision: 2, contentHash: '', content: null })
      expect(fake.rows[0]?.tombstonedAt).toBeInstanceOf(Date)
    })

    it('rejects a stale baseRevision with the current revision', async () => {
      await service.put(putArgs({ text: 'one', baseRevision: 0 }))
      await service.put(putArgs({ text: 'two', baseRevision: 1 }))

      const conflict = await conflictOf(service.remove({ ...target, baseRevision: 1 }))

      expect(conflict.getResponse()).toMatchObject({ currentRevision: 2 })
      expect(fake.rows[0]?.tombstonedAt).toBeNull()
    })
  })

  describe('list', () => {
    it('returns rows after sinceRevision including tombstones, ordered by revision', async () => {
      await service.put(putArgs({ text: 'a', baseRevision: 0, path: 'a.md' }))
      await service.put(putArgs({ text: 'b', baseRevision: 0, path: 'b.md' }))
      await service.put(putArgs({ text: 'b2', baseRevision: 1, path: 'b.md' }))
      await service.remove({ userId: USER_A, tree: 'skills', path: 'b.md', baseRevision: 2 })

      const listed = await service.list({ userId: USER_A, tree: 'skills', sinceRevision: 1 })

      expect(listed.map((file) => [file.path, file.revision])).toEqual([['b.md', 3]])
      expect(listed[0]?.tombstonedAt).not.toBeNull()
      expect(listed[0]).not.toHaveProperty('content')
      expect(await service.list({ userId: USER_A, tree: 'skills' })).toHaveLength(2)
    })

    it('scopes every query to the requesting user', async () => {
      await service.put(putArgs({ text: 'mine', baseRevision: 0, userId: USER_A }))

      expect(await service.list({ userId: USER_B, tree: 'skills' })).toEqual([])
      await service.getMany({ userId: USER_B, tree: 'skills', paths: ['review/SKILL.md'] })

      expect(fake.findManyCalls.at(-2)).toMatchObject({ where: { userId: USER_B } })
      expect(fake.findManyCalls.at(-1)).toMatchObject({ where: { userId: USER_B } })
      expect(
        await service.getMany({ userId: USER_B, tree: 'skills', paths: ['review/SKILL.md'] }),
      ).toEqual([])
    })
  })

  describe('getMany', () => {
    it('returns base64 content, null for tombstones', async () => {
      await service.put(putArgs({ text: 'a', baseRevision: 0, path: 'a.md' }))
      await service.put(putArgs({ text: 'b', baseRevision: 0, path: 'b.md' }))
      await service.remove({ userId: USER_A, tree: 'skills', path: 'b.md', baseRevision: 1 })

      const files = await service.getMany({ userId: USER_A, tree: 'skills', paths: ['a.md', 'b.md'] })

      expect(files.map((file) => [file.path, file.content])).toEqual([
        ['a.md', encode('a')],
        ['b.md', null],
      ])
    })
  })

  describe('validation', () => {
    it.each([
      ['empty', ''],
      ['absolute', '/etc/passwd'],
      ['traversal', 'a/../b'],
      ['leading traversal', '../b'],
      ['dot segment', './b'],
      ['empty segment', 'a//b'],
      ['backslash', 'a\\b'],
      ['NUL', 'a\0b'],
      ['padded segment', 'a/ b'],
      ['trailing whitespace', 'a /b'],
      ['too long', 'a'.repeat(501)],
    ])('rejects a %s path', async (_label, path) => {
      await expect(service.put(putArgs({ text: 'x', baseRevision: 0, path }))).rejects.toBeInstanceOf(
        BadRequestException,
      )
      await expect(
        service.remove({ userId: USER_A, tree: 'skills', path, baseRevision: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(fake.rows).toHaveLength(0)
    })

    it('rejects an unknown tree', async () => {
      await expect(service.list({ userId: USER_A, tree: 'settings' })).rejects.toBeInstanceOf(
        BadRequestException,
      )
    })

    it('rejects content that is not base64', async () => {
      await expect(
        service.put({ ...putArgs({ text: 'x', baseRevision: 0 }), content: '***' }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('accepts nested paths', async () => {
      await service.put(putArgs({ text: 'x', baseRevision: 0, path: 'a/b/c.md' }))

      expect(fake.rows[0]?.path).toBe('a/b/c.md')
    })
  })
})
