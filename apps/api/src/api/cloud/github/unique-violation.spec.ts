import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { seedRepoHook } from '../../../../test/github-seed'
import { inconsistentStore, isUniqueViolation } from './unique-violation'

const SUBSCRIPTION_UNIQUE = 'GithubSubscription_userId_repoFullName_branch_threadId_key'

const violationOf = async (work: () => Promise<unknown>): Promise<unknown> => {
  try {
    await work()
  } catch (failure) {
    return failure
  }
  throw new Error('expected a unique violation')
}

const sqlError = (args: { sqlState: string; constraint?: string }): Error =>
  Object.assign(new Error('failed'), {
    sqlState: args.sqlState,
    cause: { constraint: args.constraint },
  })

describe('isUniqueViolation', () => {
  useTestDatabase()

  it('matches a real violation on exactly the expected constraint', async () => {
    await db.orm.public.User.create({ id: 'usr_1', name: 'usr_1', email: 'usr_1@test.local' })
    const row = {
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
      branch: '#42',
      expiresAt: new Date(),
      liveUntil: new Date(),
    }
    await db.orm.public.GithubSubscription.create(row)

    const failure = await violationOf(() => db.orm.public.GithubSubscription.create(row))

    expect(isUniqueViolation({ error: failure, constraint: SUBSCRIPTION_UNIQUE })).toBe(true)
  })

  it('rejects a real violation on a different constraint, so unrelated violations surface raw', async () => {
    await seedRepoHook()

    const failure = await violationOf(() => seedRepoHook())

    expect(isUniqueViolation({ error: failure, constraint: SUBSCRIPTION_UNIQUE })).toBe(false)
    expect(isUniqueViolation({ error: failure, constraint: 'GithubRepoHook_pkey' })).toBe(true)
  })

  it('rejects other sql states and non-database errors', () => {
    expect(
      isUniqueViolation({
        error: sqlError({ sqlState: '23503', constraint: SUBSCRIPTION_UNIQUE }),
        constraint: SUBSCRIPTION_UNIQUE,
      }),
    ).toBe(false)
    expect(isUniqueViolation({ error: new Error('nope'), constraint: 'id' })).toBe(false)
    expect(isUniqueViolation({ error: 'P2002', constraint: 'id' })).toBe(false)
  })

  it('rejects a unique violation that names no constraint rather than guessing', () => {
    expect(isUniqueViolation({ error: sqlError({ sqlState: '23505' }), constraint: 'id' })).toBe(
      false,
    )
  })
})

describe('inconsistentStore', () => {
  it('names the missing row', () => {
    expect(inconsistentStore('alias').message).toContain('stored alias')
  })
})
