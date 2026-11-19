import type { Db } from '@dltech/atlas-db'
import { describe, expect, it, mock } from 'bun:test'
import { AWAITING_ACCESS, AwaitingAccessError } from '../../../_core/errors/awaiting-access.error'
import type { BetterAuthSessionVerifier as Verifier } from './better-auth-session-verifier'

type Verified = {
  user: { id: string; email: string }
  session: { id: string; createdAt: Date }
}

let current: Verified | null = null

mock.module('./auth.server', () => ({
  auth: { api: { getSession: async () => current } },
}))

const { BetterAuthSessionVerifier } = await import('./better-auth-session-verifier')

type UserRow = { id: string; active: boolean }

const verifierOf = (rows: readonly UserRow[]): Verifier => {
  const db = {
    orm: {
      public: {
        User: {
          first: async ({ id }: { id: string }) => rows.find((row) => row.id === id) ?? null,
        },
      },
    },
  } as unknown as Db
  return new BetterAuthSessionVerifier({ db })
}

const headers = { cookie: 'atlas.session=token' }

const sessionFor = (userId: string): Verified => ({
  user: { id: userId, email: `${userId}@atlas.dev` },
  session: { id: 'ses-1', createdAt: new Date('2026-11-19T00:00:00.000Z') },
})

describe('BetterAuthSessionVerifier', () => {
  it('returns the session of an active user', async () => {
    current = sessionFor('usr-active')

    const verified = await verifierOf([{ id: 'usr-active', active: true }]).verify({ headers })

    expect(verified).toEqual({
      userId: 'usr-active',
      sessionId: 'ses-1',
      email: 'usr-active@atlas.dev',
      sessionCreatedAt: new Date('2026-11-19T00:00:00.000Z'),
    })
  })

  it('refuses an inactive user with the awaiting-access error', async () => {
    current = sessionFor('usr-waiting')

    const attempt = verifierOf([{ id: 'usr-waiting', active: false }]).verify({ headers })

    await expect(attempt).rejects.toBeInstanceOf(AwaitingAccessError)
    await expect(attempt).rejects.toMatchObject({ code: AWAITING_ACCESS })
  })

  it('lets an inactive user through when the caller allows it', async () => {
    current = sessionFor('usr-waiting')

    const verified = await verifierOf([{ id: 'usr-waiting', active: false }]).verify(
      { headers },
      { allowInactive: true },
    )

    expect(verified?.userId).toBe('usr-waiting')
  })

  it('answers null without a session', async () => {
    current = null

    expect(await verifierOf([]).verify({ headers })).toBeNull()
  })

  it('answers null when the session names no user row', async () => {
    current = sessionFor('usr-gone')

    expect(await verifierOf([]).verify({ headers })).toBeNull()
  })
})
