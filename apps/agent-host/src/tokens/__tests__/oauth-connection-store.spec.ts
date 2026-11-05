import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { cipher, seedOwner } from '../../config/__tests__/config-reader.fixture'
import { OauthConnectionStore } from '../oauth-connection-store'

const testDb = useTestDatabase()
const STARTED = new Date('2026-11-05T12:00:00.000Z')

const seedConnection = async (over: Record<string, unknown> = {}): Promise<void> => {
  await seedOwner(testDb().db)
  await testDb().db.orm.public.OauthConnection.create({
    id: 'conn-1',
    provider: 'anthropic',
    userId: 'user-1',
    authorizationId: 'conn-1',
    sealedTokens: cipher.encrypt(JSON.stringify({ accessToken: 'at', refreshToken: 'rt' })),
    ...over,
  })
}

const generationOf = async (): Promise<number> =>
  (await testDb().db.orm.public.OauthConnection.first({ id: 'conn-1' }))?.generation ?? -1

const claimFor = async (args: { attemptId: string; generation: number }): Promise<boolean> =>
  new OauthConnectionStore(testDb().db).claim({
    id: 'conn-1',
    userId: 'user-1',
    generation: args.generation,
    attemptId: args.attemptId,
    startedAt: STARTED,
  })

describe('OauthConnectionStore.claim', () => {
  it('lets exactly one of two claimants at the same generation win', async () => {
    await seedConnection()
    const generation = await generationOf()
    expect(await claimFor({ attemptId: 'v2-a', generation })).toBe(true)
    expect(await claimFor({ attemptId: 'v2-b', generation })).toBe(false)
  })

  it('refuses while another attempt marker is live', async () => {
    await seedConnection({ refreshAttempt: 'v1-attempt', refreshStartedAt: STARTED })
    expect(await claimFor({ attemptId: 'v2', generation: await generationOf() })).toBe(false)
    const row = await testDb().db.orm.public.OauthConnection.first({ id: 'conn-1' })
    expect(row?.refreshAttempt).toBe('v1-attempt')
  })

  it('refuses a claim made against a generation that has moved on', async () => {
    await seedConnection()
    expect(await claimFor({ attemptId: 'v2', generation: (await generationOf()) + 1 })).toBe(false)
  })
})
