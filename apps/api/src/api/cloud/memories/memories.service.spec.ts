import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  EMemoryScope,
  EMemoryType,
  MEMORY_EDIT_AMBIGUOUS_CODE,
  MEMORY_EDIT_NO_MATCH_CODE,
  MEMORY_STALE_REVISION_CODE,
} from '@dltech/atlas-wire'
import type { PrismaClient } from '../../../generated/prisma/client'

mock.module('../../../db', () => ({ db: fake.db as unknown as PrismaClient }))

import { sharedMemoryDb as fake } from './memories.fake-db'
import { MemoriesService } from './memories.service'

const USER_A = 'user-a'
const USER_B = 'user-b'
const PROJECT = 'acme/widgets'

const globalNote = ({ name, body = 'fact. **Why:** x' }: { name: string; body?: string }) => ({
  userId: USER_A,
  scope: EMemoryScope.Global,
  name,
  description: `about ${name}`,
  type: EMemoryType.Reference,
  body,
})

describe('MemoriesService', () => {
  let service: MemoriesService

  beforeEach(() => {
    fake.reset()
    service = new MemoriesService()
  })

  it('put creates at revision 1 and bumps the revision on every rewrite', async () => {
    const created = await service.put(globalNote({ name: 'deflate' }))
    const rewritten = await service.put(globalNote({ name: 'deflate', body: 'new body' }))
    const third = await service.put(globalNote({ name: 'deflate', body: 'newer body' }))

    expect([created.revision, rewritten.revision, third.revision]).toEqual([1, 2, 3])
    expect(fake.rows).toHaveLength(1)
    expect(created).toMatchObject({ scope: 'global', project: null, name: 'deflate', type: 'reference' })
    expect((await service.get({ userId: USER_A, scope: EMemoryScope.Global, name: 'deflate' })).body).toBe(
      'newer body',
    )
  })

  it('edit replaces the single occurrence and returns the next revision', async () => {
    await service.put(globalNote({ name: 'deflate', body: 'alpha beta gamma' }))

    const edited = await service.edit({
      userId: USER_A,
      scope: EMemoryScope.Global,
      name: 'deflate',
      old: 'beta',
      replacement: 'BETA',
      revision: 1,
    })

    expect(edited.revision).toBe(2)
    expect((await service.get({ userId: USER_A, scope: EMemoryScope.Global, name: 'deflate' })).body).toBe(
      'alpha BETA gamma',
    )
  })

  it('edit with a stale revision is a 409 naming the current revision', async () => {
    await service.put(globalNote({ name: 'deflate' }))
    await service.put(globalNote({ name: 'deflate', body: 'second' }))
    const args = {
      userId: USER_A,
      scope: EMemoryScope.Global,
      name: 'deflate',
      old: 'second',
      replacement: 'x',
      revision: 1,
    }

    const failure = await service.edit(args).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConflictException)
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: MEMORY_STALE_REVISION_CODE,
      message: expect.stringContaining('revision 2'),
    })
  })

  it('edit that loses the race at updateMany is a stale 409 naming the real current revision', async () => {
    await service.put(globalNote({ name: 'deflate', body: 'alpha' }))
    fake.interleaveBeforeUpdateMany(() => {
      void service.put(globalNote({ name: 'deflate', body: 'alpha one' }))
      void service.put(globalNote({ name: 'deflate', body: 'alpha two' }))
    })

    const failure = await service
      .edit({ userId: USER_A, scope: EMemoryScope.Global, name: 'deflate', old: 'alpha', replacement: 'beta', revision: 1 })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConflictException)
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: MEMORY_STALE_REVISION_CODE,
      message: expect.stringContaining('revision 3'),
    })
    expect(fake.rows[0]?.body).toBe('alpha two')
  })

  it('treats overlapping matches as ambiguous', async () => {
    await service.put(globalNote({ name: 'deflate', body: 'aaa' }))

    const failure = await service
      .edit({ userId: USER_A, scope: EMemoryScope.Global, name: 'deflate', old: 'aa', replacement: 'x', revision: 1 })
      .catch((error: unknown) => error)

    expect((failure as UnprocessableEntityException).getResponse()).toMatchObject({
      code: MEMORY_EDIT_AMBIGUOUS_CODE,
    })
    expect(fake.rows[0]?.body).toBe('aaa')
  })

  it('edit with no match is a 422 memory-edit-no-match', async () => {
    await service.put(globalNote({ name: 'deflate', body: 'alpha' }))

    const failure = await service
      .edit({ userId: USER_A, scope: EMemoryScope.Global, name: 'deflate', old: 'zzz', replacement: 'x', revision: 1 })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(UnprocessableEntityException)
    expect((failure as UnprocessableEntityException).getResponse()).toMatchObject({
      code: MEMORY_EDIT_NO_MATCH_CODE,
    })
  })

  it('edit with an ambiguous match is a 422 memory-edit-ambiguous and leaves the body alone', async () => {
    await service.put(globalNote({ name: 'deflate', body: 'ab ab' }))

    const failure = await service
      .edit({ userId: USER_A, scope: EMemoryScope.Global, name: 'deflate', old: 'ab', replacement: 'x', revision: 1 })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(UnprocessableEntityException)
    expect((failure as UnprocessableEntityException).getResponse()).toMatchObject({
      code: MEMORY_EDIT_AMBIGUOUS_CODE,
    })
    expect(fake.rows[0]?.body).toBe('ab ab')
    expect(fake.rows[0]?.revision).toBe(1)
  })

  it('edit and remove of a missing memory are 404', async () => {
    await expect(
      service.edit({ userId: USER_A, scope: EMemoryScope.Global, name: 'nope', old: 'a', replacement: 'b', revision: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.remove({ userId: USER_A, scope: EMemoryScope.Global, name: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('remove deletes the row once', async () => {
    await service.put(globalNote({ name: 'deflate' }))

    await service.remove({ userId: USER_A, scope: EMemoryScope.Global, name: 'deflate' })

    expect(fake.rows).toHaveLength(0)
    await expect(
      service.remove({ userId: USER_A, scope: EMemoryScope.Global, name: 'deflate' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('list returns global rows plus the named project, newest first', async () => {
    await service.put(globalNote({ name: 'older' }))
    await service.put({ ...globalNote({ name: 'widget-fact' }), scope: EMemoryScope.Project, project: PROJECT })
    await service.put({ ...globalNote({ name: 'other-fact' }), scope: EMemoryScope.Project, project: 'acme/gadgets' })
    await service.put(globalNote({ name: 'newest' }))

    expect((await service.list({ userId: USER_A, project: PROJECT })).map((row) => row.name)).toEqual([
      'newest',
      'widget-fact',
      'older',
    ])
    expect((await service.list({ userId: USER_A })).map((row) => row.name)).toEqual(['newest', 'older'])
  })

  it('isolates the same name across users and across projects', async () => {
    await service.put(globalNote({ name: 'shared', body: 'a-body' }))
    await service.put({ ...globalNote({ name: 'shared', body: 'b-body' }), userId: USER_B })
    await service.put({ ...globalNote({ name: 'shared', body: 'p1' }), scope: EMemoryScope.Project, project: PROJECT })
    await service.put({ ...globalNote({ name: 'shared', body: 'p2' }), scope: EMemoryScope.Project, project: 'acme/gadgets' })

    expect((await service.get({ userId: USER_A, scope: EMemoryScope.Global, name: 'shared' })).body).toBe('a-body')
    expect((await service.get({ userId: USER_B, scope: EMemoryScope.Global, name: 'shared' })).body).toBe('b-body')
    expect(
      (await service.get({ userId: USER_A, scope: EMemoryScope.Project, project: PROJECT, name: 'shared' })).body,
    ).toBe('p1')
    await expect(
      service.get({ userId: USER_B, scope: EMemoryScope.Project, project: PROJECT, name: 'shared' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.remove({ userId: USER_B, scope: EMemoryScope.Global, name: 'shared' }),
    ).resolves.toBeUndefined()
    expect(fake.rows.filter((row) => row.userId === USER_A)).toHaveLength(3)
  })

  it('rejects a project scope without a project and a global scope with one', async () => {
    await expect(
      service.put({ ...globalNote({ name: 'x' }), scope: EMemoryScope.Project }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.put({ ...globalNote({ name: 'x' }), project: PROJECT })).rejects.toBeInstanceOf(BadRequestException)
    expect(fake.rows).toHaveLength(0)
  })
})
