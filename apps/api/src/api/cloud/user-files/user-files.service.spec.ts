import { createHash } from 'node:crypto'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { UserFilesService } from './user-files.service'

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
  const database = useTestDatabase()
  const rowsOf = () =>
    db.orm.public.UserFile.where((row) => row.id.neq(''))
      .orderBy((row) => row.path.asc())
      .all()
  let service: UserFilesService

  beforeEach(async () => {
    for (const id of [USER_A, USER_B]) await seedUser({ db: database().db, id })
    service = new UserFilesService()
  })

  describe('put', () => {
    it('creates revision 1 when the file is new and baseRevision is 0', async () => {
      expect(await service.put(putArgs({ text: 'one', baseRevision: 0 }))).toEqual({ revision: 1 })

      const rows = await rowsOf()
      expect(rows[0]).toMatchObject({ revision: 1, contentHash: hashOf('one') })
      expect(Buffer.from(rows[0]?.content ?? []).toString()).toBe('one')
    })

    it('refuses a create whose baseRevision claims the file already exists', async () => {
      const conflict = await conflictOf(service.put(putArgs({ text: 'one', baseRevision: 3 })))

      expect(conflict.getResponse()).toMatchObject({ currentRevision: 0, contentHash: '' })
      expect(await rowsOf()).toHaveLength(0)
    })

    it('rejects a stale second writer with the current revision and hash', async () => {
      await service.put(putArgs({ text: 'one', baseRevision: 0 }))
      await service.put(putArgs({ text: 'two', baseRevision: 1 }))

      const conflict = await conflictOf(service.put(putArgs({ text: 'late', baseRevision: 1 })))

      expect(conflict.getResponse()).toMatchObject({
        currentRevision: 2,
        contentHash: hashOf('two'),
      })
      expect((await rowsOf())[0]?.contentHash).toBe(hashOf('two'))
    })

    it('rejects a create that loses the insert race with the winner state', async () => {
      const original = db.orm.public.UserFile.first.bind(db.orm.public.UserFile)
      const winner = putArgs({ text: 'one', baseRevision: 0 })
      const lookup = vi
        .spyOn(db.orm.public.UserFile, 'first')
        .mockImplementationOnce(async () => {
          await service.put(winner)
          return null
        })
        .mockImplementation(original)

      const conflict = await conflictOf(service.put(putArgs({ text: 'racer', baseRevision: 0 })))

      expect(lookup).toHaveBeenCalled()
      expect(conflict.getResponse()).toMatchObject({
        currentRevision: 1,
        contentHash: hashOf('one'),
      })
    })

    it('bumps the revision, stores the hash and clears a tombstone on a matching base', async () => {
      await service.put(putArgs({ text: 'one', baseRevision: 0 }))
      await service.remove({
        userId: USER_A,
        tree: 'skills',
        path: 'review/SKILL.md',
        baseRevision: 1,
      })

      expect(await service.put(putArgs({ text: 'back', baseRevision: 2 }))).toEqual({ revision: 3 })

      expect((await rowsOf())[0]).toMatchObject({
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

      const rows = await rowsOf()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ revision: 2, contentHash: '', content: null })
      expect(rows[0]?.tombstonedAt).toBeInstanceOf(Date)
    })

    it('rejects a stale baseRevision with the current revision', async () => {
      await service.put(putArgs({ text: 'one', baseRevision: 0 }))
      await service.put(putArgs({ text: 'two', baseRevision: 1 }))

      const conflict = await conflictOf(service.remove({ ...target, baseRevision: 1 }))

      expect(conflict.getResponse()).toMatchObject({ currentRevision: 2 })
      expect((await rowsOf())[0]?.tombstonedAt).toBeNull()
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
      expect(
        await service.getMany({ userId: USER_B, tree: 'skills', paths: ['review/SKILL.md'] }),
      ).toEqual([])
      expect(await service.list({ userId: USER_A, tree: 'skills' })).toHaveLength(1)
      expect(
        await service.getMany({ userId: USER_A, tree: 'skills', paths: ['review/SKILL.md'] }),
      ).toHaveLength(1)
    })
  })

  describe('getMany', () => {
    it('returns base64 content, null for tombstones', async () => {
      await service.put(putArgs({ text: 'a', baseRevision: 0, path: 'a.md' }))
      await service.put(putArgs({ text: 'b', baseRevision: 0, path: 'b.md' }))
      await service.remove({ userId: USER_A, tree: 'skills', path: 'b.md', baseRevision: 1 })

      const files = await service.getMany({
        userId: USER_A,
        tree: 'skills',
        paths: ['a.md', 'b.md'],
      })

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
      await expect(
        service.put(putArgs({ text: 'x', baseRevision: 0, path })),
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.remove({ userId: USER_A, tree: 'skills', path, baseRevision: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(await rowsOf()).toHaveLength(0)
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

      expect((await rowsOf())[0]?.path).toBe('a/b/c.md')
    })
  })
})
