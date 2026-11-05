import { describe, expect, it } from 'bun:test'

import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'

import { createPgStreamAuth } from '../pg-stream-auth'

const testDb = useTestDatabase()

const seedAuthSession = async (args: { token: string; expiresAt: Date }) => {
  const { db } = testDb()
  await seedUser({ db, id: 'user-1' })
  await db.orm.public.AuthSession.create({
    id: `auth-${args.token}`,
    token: args.token,
    userId: 'user-1',
    expiresAt: args.expiresAt,
  })
}

describe('createPgStreamAuth', () => {
  const inAnHour = (): Date => new Date(Date.now() + 3_600_000)

  it('resolves a raw token to its user and expiry', async () => {
    const expiresAt = inAnHour()
    await seedAuthSession({ token: 'raw-token', expiresAt })
    const auth = createPgStreamAuth({ pool: testDb().pool })
    expect(await auth.resolve('raw-token')).toEqual({
      userId: 'user-1',
      expiresAt: expiresAt.getTime(),
    })
  })

  it('resolves the signed and the percent-encoded cookie forms', async () => {
    await seedAuthSession({ token: 'raw-token', expiresAt: inAnHour() })
    const auth = createPgStreamAuth({ pool: testDb().pool })
    expect((await auth.resolve('raw-token.c2ln%2Bnature%3D'))?.userId).toBe('user-1')
    expect((await auth.resolve('raw-token.c2ln+nature='))?.userId).toBe('user-1')
  })

  it('resolves nothing for an expired token', async () => {
    await seedAuthSession({ token: 'old-token', expiresAt: new Date(Date.now() - 1_000) })
    const auth = createPgStreamAuth({ pool: testDb().pool })
    expect(await auth.resolve('old-token')).toBeUndefined()
  })

  it('resolves nothing for a missing or empty token', async () => {
    const auth = createPgStreamAuth({ pool: testDb().pool })
    expect(await auth.resolve('missing')).toBeUndefined()
    expect(await auth.resolve('')).toBeUndefined()
  })
})
