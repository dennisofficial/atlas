import { NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers, STAMP, USER_A, USER_B } from '../../../../test/session-seed'
import { ownedThread } from './ownership'

const reader = { orm: db.orm }

describe('ownedThread', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A, USER_B)
  })

  it('returns a thread the user owns', async () => {
    await seedThreadRow({ id: 'thr-1', userId: USER_A })

    const thread = await ownedThread({ reader, userId: USER_A, threadId: 'thr-1' })

    expect(thread.id).toBe('thr-1')
  })

  it('answers 404 for a thread whose session was soft-deleted', async () => {
    await seedThreadRow({ id: 'thr-1', userId: USER_A, deletedAt: STAMP })

    const failure = await ownedThread({ reader, userId: USER_A, threadId: 'thr-1' }).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(NotFoundException)
    expect((failure as NotFoundException).message).toBe('thread not found')
  })

  it('answers 404 for a thread of another user', async () => {
    await seedThreadRow({ id: 'thr-1', userId: USER_A })

    const failure = await ownedThread({ reader, userId: USER_B, threadId: 'thr-1' }).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(NotFoundException)
  })
})
