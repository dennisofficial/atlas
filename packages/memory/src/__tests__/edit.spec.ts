import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  EMemoryScope,
  MEMORY_EDIT_AMBIGUOUS_CODE,
  MEMORY_EDIT_NO_MATCH_CODE,
  MEMORY_STALE_REVISION_CODE,
} from '@dltech/atlas-wire'

import { MemoryEditRefusedError, MemoryStaleRevisionError } from '../errors'
import { USER_A, USER_B, globalNote, memoryOpsOf, waitForBlockedWriter } from './fixtures'

describe('memory edits', () => {
  const database = useTestDatabase()
  const { db } = database()
  const { put, get, edit, rowsOf } = memoryOpsOf(db)

  beforeEach(async () => {
    for (const id of [USER_A, USER_B]) await seedUser({ db, id })
  })

  it('edit replaces the single occurrence and returns the next revision', async () => {
    await put(globalNote({ name: 'deflate', body: 'alpha beta gamma' }))

    const edited = await edit({
      userId: USER_A,
      scope: EMemoryScope.Global,
      name: 'deflate',
      old: 'beta',
      replacement: 'BETA',
      revision: 1,
    })

    expect(edited.revision).toBe(2)
    expect((await get({ userId: USER_A, scope: EMemoryScope.Global, name: 'deflate' })).body).toBe(
      'alpha BETA gamma',
    )
  })

  it('edit with a stale revision names the current revision', async () => {
    await put(globalNote({ name: 'deflate' }))
    await put(globalNote({ name: 'deflate', body: 'second' }))

    const failure = await edit({
      userId: USER_A,
      scope: EMemoryScope.Global,
      name: 'deflate',
      old: 'second',
      replacement: 'x',
      revision: 1,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MemoryStaleRevisionError)
    expect(failure).toMatchObject({
      code: MEMORY_STALE_REVISION_CODE,
      current: 2,
      message: 'memory is at revision 2, not 1; read it again',
    })
  })

  it('edit that loses the race at the guarded update is a stale revision naming the real current one', async () => {
    await put(globalNote({ name: 'deflate', body: 'alpha' }))
    const writer = await database().pool.connect()
    await writer.query('BEGIN')
    await writer.query('SELECT 1 FROM "Memory" WHERE name = $1 FOR UPDATE', ['deflate'])

    const editing = edit({
      userId: USER_A,
      scope: EMemoryScope.Global,
      name: 'deflate',
      old: 'alpha',
      replacement: 'beta',
      revision: 1,
    }).catch((error: unknown) => error)
    await waitForBlockedWriter(database().pool)
    await writer.query(
      `UPDATE "Memory" SET body = 'alpha two', revision = revision + 2 WHERE name = $1`,
      ['deflate'],
    )
    await writer.query('COMMIT')
    writer.release()
    const failure = await editing

    expect(failure).toBeInstanceOf(MemoryStaleRevisionError)
    expect(failure).toMatchObject({
      code: MEMORY_STALE_REVISION_CODE,
      message: expect.stringContaining('revision 3'),
    })
    expect((await rowsOf())[0]?.body).toBe('alpha two')
  })

  it('treats overlapping matches as ambiguous', async () => {
    await put(globalNote({ name: 'deflate', body: 'aaa' }))

    const failure = await edit({
      userId: USER_A,
      scope: EMemoryScope.Global,
      name: 'deflate',
      old: 'aa',
      replacement: 'x',
      revision: 1,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MemoryEditRefusedError)
    expect(failure).toMatchObject({
      code: MEMORY_EDIT_AMBIGUOUS_CODE,
      message: 'the text to replace occurs more than once; include more surrounding text',
    })
    expect((await rowsOf())[0]?.body).toBe('aaa')
  })

  it('edit with no match is memory-edit-no-match', async () => {
    await put(globalNote({ name: 'deflate', body: 'alpha' }))

    const failure = await edit({
      userId: USER_A,
      scope: EMemoryScope.Global,
      name: 'deflate',
      old: 'zzz',
      replacement: 'x',
      revision: 1,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MemoryEditRefusedError)
    expect(failure).toMatchObject({
      code: MEMORY_EDIT_NO_MATCH_CODE,
      message: 'the text to replace does not occur in the memory',
    })
  })

  it('edit with an ambiguous match is memory-edit-ambiguous and leaves the body alone', async () => {
    await put(globalNote({ name: 'deflate', body: 'ab ab' }))

    const failure = await edit({
      userId: USER_A,
      scope: EMemoryScope.Global,
      name: 'deflate',
      old: 'ab',
      replacement: 'x',
      revision: 1,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(MemoryEditRefusedError)
    expect(failure).toMatchObject({ code: MEMORY_EDIT_AMBIGUOUS_CODE })
    expect((await rowsOf())[0]?.body).toBe('ab ab')
    expect((await rowsOf())[0]?.revision).toBe(1)
  })
})
