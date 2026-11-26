import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { EMemoryScope } from '@dltech/atlas-core'

import { MemoryInvalidError, MemoryNotFoundError } from '../errors'
import { GROUP, PROJECT, USER_A, USER_B, globalNote, memoryOpsOf } from './fixtures'

describe('memories', () => {
  const database = useTestDatabase()
  const { db } = database()
  const { put, get, remove, list, listAll, rowsOf, stampInOrder } = memoryOpsOf(db)

  beforeEach(async () => {
    for (const id of [USER_A, USER_B]) await seedUser({ db, id })
  })

  it('put creates at revision 1 and bumps the revision on every rewrite', async () => {
    const created = await put(globalNote({ name: 'deflate' }))
    const rewritten = await put(globalNote({ name: 'deflate', body: 'new body' }))
    const third = await put(globalNote({ name: 'deflate', body: 'newer body' }))

    expect([created.revision, rewritten.revision, third.revision]).toEqual([1, 2, 3])
    expect(await rowsOf()).toHaveLength(1)
    expect(created).toMatchObject({
      scope: 'global',
      project: null,
      name: 'deflate',
      type: 'reference',
    })
    expect((await get({ userId: USER_A, scope: EMemoryScope.Global, name: 'deflate' })).body).toBe(
      'newer body',
    )
  })

  it('edit and remove of a missing memory are not found', async () => {
    const { edit } = memoryOpsOf(db)

    await expect(
      edit({
        userId: USER_A,
        scope: EMemoryScope.Global,
        name: 'nope',
        old: 'a',
        replacement: 'b',
        revision: 1,
      }),
    ).rejects.toBeInstanceOf(MemoryNotFoundError)
    await expect(
      remove({ userId: USER_A, scope: EMemoryScope.Global, name: 'nope' }),
    ).rejects.toBeInstanceOf(MemoryNotFoundError)
  })

  it('remove deletes the row once', async () => {
    await put(globalNote({ name: 'deflate' }))

    await remove({ userId: USER_A, scope: EMemoryScope.Global, name: 'deflate' })

    expect(await rowsOf()).toHaveLength(0)
    await expect(
      remove({ userId: USER_A, scope: EMemoryScope.Global, name: 'deflate' }),
    ).rejects.toBeInstanceOf(MemoryNotFoundError)
  })

  it('stores a group memory under its group and lists it with global rows', async () => {
    await put(globalNote({ name: 'prefers-bun' }))
    await put({
      ...globalNote({ name: 'ships-on-fridays' }),
      scope: EMemoryScope.Group,
      groupId: GROUP,
    })
    await put({
      ...globalNote({ name: 'other-group' }),
      scope: EMemoryScope.Group,
      groupId: 'pgr_other',
    })
    await put({
      ...globalNote({ name: 'project-fact' }),
      scope: EMemoryScope.Project,
      project: PROJECT,
    })

    const listed = await list({ userId: USER_A, groupId: GROUP, project: PROJECT })

    expect(listed.map((row) => row.name).sort()).toEqual([
      'prefers-bun',
      'project-fact',
      'ships-on-fridays',
    ])
    const grouped = listed.find((row) => row.name === 'ships-on-fridays')
    expect({ groupId: grouped?.groupId, project: grouped?.project, scope: grouped?.scope }).toEqual(
      {
        groupId: GROUP,
        project: null,
        scope: EMemoryScope.Group,
      },
    )
    expect((await list({ userId: USER_A, groupId: GROUP })).map((row) => row.name).sort()).toEqual([
      'prefers-bun',
      'ships-on-fridays',
    ])
  })

  it('refuses a group memory without a group and a group memory with a project', async () => {
    await expect(
      put({ ...globalNote({ name: 'no-group' }), scope: EMemoryScope.Group }),
    ).rejects.toBeInstanceOf(MemoryInvalidError)
    await expect(
      put({
        ...globalNote({ name: 'both' }),
        scope: EMemoryScope.Group,
        groupId: GROUP,
        project: PROJECT,
      }),
    ).rejects.toBeInstanceOf(MemoryInvalidError)
  })

  it('list returns global rows plus the named project, newest first', async () => {
    await put(globalNote({ name: 'older' }))
    await put({
      ...globalNote({ name: 'widget-fact' }),
      scope: EMemoryScope.Project,
      project: PROJECT,
    })
    await put({
      ...globalNote({ name: 'other-fact' }),
      scope: EMemoryScope.Project,
      project: 'acme/gadgets',
    })
    await put(globalNote({ name: 'newest' }))
    await stampInOrder(['older', 'widget-fact', 'other-fact', 'newest'])

    expect((await list({ userId: USER_A, project: PROJECT })).map((row) => row.name)).toEqual([
      'newest',
      'widget-fact',
      'older',
    ])
    expect((await list({ userId: USER_A })).map((row) => row.name)).toEqual(['newest', 'older'])
    expect((await listAll({ userId: USER_A })).map((row) => row.name)).toEqual([
      'newest',
      'other-fact',
      'widget-fact',
      'older',
    ])
  })

  it('isolates the same name across users and across projects', async () => {
    await put(globalNote({ name: 'shared', body: 'a-body' }))
    await put({ ...globalNote({ name: 'shared', body: 'b-body' }), userId: USER_B })
    await put({
      ...globalNote({ name: 'shared', body: 'p1' }),
      scope: EMemoryScope.Project,
      project: PROJECT,
    })
    await put({
      ...globalNote({ name: 'shared', body: 'p2' }),
      scope: EMemoryScope.Project,
      project: 'acme/gadgets',
    })

    expect((await get({ userId: USER_A, scope: EMemoryScope.Global, name: 'shared' })).body).toBe(
      'a-body',
    )
    expect((await get({ userId: USER_B, scope: EMemoryScope.Global, name: 'shared' })).body).toBe(
      'b-body',
    )
    expect(
      (
        await get({
          userId: USER_A,
          scope: EMemoryScope.Project,
          project: PROJECT,
          name: 'shared',
        })
      ).body,
    ).toBe('p1')
    await expect(
      get({
        userId: USER_B,
        scope: EMemoryScope.Project,
        project: PROJECT,
        name: 'shared',
      }),
    ).rejects.toBeInstanceOf(MemoryNotFoundError)
    await expect(
      remove({ userId: USER_B, scope: EMemoryScope.Global, name: 'shared' }),
    ).resolves.toBeUndefined()
    expect((await rowsOf()).filter((row) => row.userId === USER_A)).toHaveLength(3)
  })

  it('rejects a project scope without a project and a global scope with one', async () => {
    await expect(
      put({ ...globalNote({ name: 'x' }), scope: EMemoryScope.Project }),
    ).rejects.toBeInstanceOf(MemoryInvalidError)
    await expect(put({ ...globalNote({ name: 'x' }), project: PROJECT })).rejects.toBeInstanceOf(
      MemoryInvalidError,
    )
    await expect(put({ ...globalNote({ name: 'x' }), project: null })).rejects.toBeInstanceOf(
      MemoryInvalidError,
    )
    expect(await rowsOf()).toHaveLength(0)
  })
})
