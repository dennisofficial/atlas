import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { OAuthRefreshError } from '../../../_lib/oauth-refresh'
import type { PrismaClient } from '../../../generated/prisma/client'
import { BrokerService } from './broker.service'
import { EAuthKind, EAuthProvider } from './accounts.types'

const HEX_KEY =
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const USER = 'user-1'

interface AgentAccountRow {
  id: string
  provider: string
  kind: string
  sealedSecret: string
  secretVersion: number
  userId: string
}

const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
const seal = (secret: unknown): string => cipher.encrypt(JSON.stringify(secret))

const fake = vi.hoisted(() => {
  const accounts: AgentAccountRow[] = []
  let loseNextRace = false

  const db = {
    agentAccount: {
      findFirst: async (args: { where: { id: string; userId: string } }) =>
        accounts.find(
          (row) => row.id === args.where.id && row.userId === args.where.userId,
        ) ?? null,
      updateMany: async (args: {
        where: { id: string; secretVersion: number }
        data: { sealedSecret: string; kind: string; status: string; secretVersion: number }
      }) => {
        const row = accounts.find(
          (candidate) =>
            candidate.id === args.where.id &&
            candidate.secretVersion === args.where.secretVersion,
        )
        if (row === undefined || loseNextRace) {
          loseNextRace = false
          // the concurrent winner: rotates the row under us with its own fresh token
          const winner = accounts.find((candidate) => candidate.id === args.where.id)
          if (winner !== undefined) {
            winner.sealedSecret = seal({
              kind: 'oauth',
              tokens: {
                accessToken: 'winner-access',
                refreshToken: 'winner-refresh',
                expiresAt: new Date(Date.now() + 3600_000).toISOString(),
              },
            })
            winner.secretVersion += 1
          }
          return { count: 0 }
        }
        Object.assign(row, args.data)
        return { count: 1 }
      },
    },
  }

  return {
    db,
    accounts,
    loseTheNextRace: () => {
      loseNextRace = true
    },
    reset: () => {
      accounts.length = 0
      loseNextRace = false
    },
  }
})

vi.mock('../../../db', () => ({ db: fake.db as unknown as PrismaClient }))

const seedAccount = (args: {
  id: string
  provider: string
  secret: unknown
}): void => {
  fake.accounts.push({
    id: args.id,
    provider: args.provider,
    kind: 'oauth',
    sealedSecret: seal(args.secret),
    secretVersion: 0,
    userId: USER,
  })
}

const oauthSecret = (args: { expiresInMs: number }) => ({
  kind: EAuthKind.Oauth,
  tokens: {
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: new Date(Date.now() + args.expiresInMs).toISOString(),
  },
})

const stubProviderRefresh = (body: Record<string, unknown>) => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('BrokerService', () => {
  let broker: BrokerService

  beforeEach(() => {
    fake.reset()
    broker = new BrokerService(cipher)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the api key for an api-key account without calling any provider', async () => {
    const fetchMock = stubProviderRefresh({})
    fake.accounts.push({
      id: 'acc_key',
      provider: EAuthProvider.Anthropic,
      kind: EAuthKind.ApiKey,
      sealedSecret: seal({ kind: EAuthKind.ApiKey, apiKey: 'sk-static' }),
      secretVersion: 0,
      userId: USER,
    })

    const result = await broker.accessToken({ userId: USER, accountId: 'acc_key' })

    expect(result).toEqual({ accessToken: 'sk-static', expiresAt: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a still-fresh oauth token without refreshing or writing', async () => {
    const fetchMock = stubProviderRefresh({})
    seedAccount({
      id: 'acc_fresh',
      provider: EAuthProvider.Anthropic,
      secret: oauthSecret({ expiresInMs: 3600_000 }),
    })

    const result = await broker.accessToken({ userId: USER, accountId: 'acc_fresh' })

    expect(result.accessToken).toBe('old-access')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fake.accounts[0]?.secretVersion).toBe(0)
  })

  it('refreshes an expiring oauth token and persists the rotation under the version precondition', async () => {
    const fetchMock = stubProviderRefresh({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
    })
    seedAccount({
      id: 'acc_due',
      provider: EAuthProvider.Anthropic,
      secret: oauthSecret({ expiresInMs: 60_000 }),
    })

    const result = await broker.accessToken({ userId: USER, accountId: 'acc_due' })

    expect(result.accessToken).toBe('new-access')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    expect(url).toBe('https://platform.claude.com/v1/oauth/token')
    expect(JSON.parse(request.body)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    })

    const row = fake.accounts[0]
    expect(row?.secretVersion).toBe(1)
    const stored = JSON.parse(cipher.decrypt(row?.sealedSecret ?? '')) as {
      tokens: { accessToken: string; refreshToken: string }
    }
    expect(stored.tokens.accessToken).toBe('new-access')
    expect(stored.tokens.refreshToken).toBe('new-refresh')
  })

  it('keeps the old codex refresh token when the rotation omits one', async () => {
    stubProviderRefresh({ access_token: 'codex-access', expires_in: 3600 })
    seedAccount({
      id: 'acc_codex',
      provider: EAuthProvider.OpenAI,
      secret: oauthSecret({ expiresInMs: 60_000 }),
    })

    const result = await broker.accessToken({ userId: USER, accountId: 'acc_codex' })

    expect(result.accessToken).toBe('codex-access')
    const row = fake.accounts[0]
    const stored = JSON.parse(cipher.decrypt(row?.sealedSecret ?? '')) as {
      tokens: { refreshToken: string }
    }
    expect(stored.tokens.refreshToken).toBe('old-refresh')
  })

  it('returns the winner of a lost rotation race without a second provider call', async () => {
    const fetchMock = stubProviderRefresh({
      access_token: 'our-access',
      refresh_token: 'our-refresh',
      expires_in: 3600,
    })
    seedAccount({
      id: 'acc_race',
      provider: EAuthProvider.Anthropic,
      secret: oauthSecret({ expiresInMs: 60_000 }),
    })
    fake.loseTheNextRace()

    const result = await broker.accessToken({ userId: USER, accountId: 'acc_race' })

    expect(result.accessToken).toBe('winner-access')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fake.accounts[0]?.secretVersion).toBe(1)
  })

  it('throws a conflict when the row rotates out from under us twice', async () => {
    stubProviderRefresh({
      access_token: 'our-access',
      refresh_token: 'our-refresh',
      expires_in: 3600,
    })
    seedAccount({
      id: 'acc_stuck',
      provider: EAuthProvider.Anthropic,
      secret: oauthSecret({ expiresInMs: 60_000 }),
    })
    // both attempts lose: the fake's winner-token stays expiring, so pass two rotates too
    const win = fake.db.agentAccount.updateMany
    fake.db.agentAccount.updateMany = async (args) => {
      const row = fake.accounts.find((candidate) => candidate.id === args.where.id)
      if (row !== undefined) {
        row.sealedSecret = seal(oauthSecret({ expiresInMs: 60_000 }))
        row.secretVersion += 1
      }
      return { count: 0 }
    }

    await expect(
      broker.accessToken({ userId: USER, accountId: 'acc_stuck' }),
    ).rejects.toBeInstanceOf(ConflictException)

    fake.db.agentAccount.updateMany = win
  })

  it('refreshes a fresh token the client has rejected, because the provider revoked it', async () => {
    const fetchMock = stubProviderRefresh({
      access_token: 'rotated-access',
      refresh_token: 'rotated-refresh',
      expires_in: 3600,
    })
    seedAccount({
      id: 'acc_revoked',
      provider: EAuthProvider.Anthropic,
      secret: oauthSecret({ expiresInMs: 3600_000 }),
    })

    const result = await broker.accessToken({
      userId: USER,
      accountId: 'acc_revoked',
      rejectedAccessToken: 'old-access',
    })

    expect(result.accessToken).toBe('rotated-access')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('serves the fresh token when the rejection no longer matches, because someone else rotated', async () => {
    const fetchMock = stubProviderRefresh({})
    seedAccount({
      id: 'acc_moved',
      provider: EAuthProvider.Anthropic,
      secret: oauthSecret({ expiresInMs: 3600_000 }),
    })

    const result = await broker.accessToken({
      userId: USER,
      accountId: 'acc_moved',
      rejectedAccessToken: 'a-token-from-before-the-rotation',
    })

    expect(result.accessToken).toBe('old-access')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an account that holds no refresh token', async () => {
    seedAccount({
      id: 'acc_dead',
      provider: EAuthProvider.Anthropic,
      secret: {
        kind: EAuthKind.Oauth,
        tokens: {
          accessToken: 'old-access',
          refreshToken: '',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    })

    await expect(
      broker.accessToken({ userId: USER, accountId: 'acc_dead' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('surfaces a provider refusal as an OAuthRefreshError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 401 })),
    )
    seedAccount({
      id: 'acc_refused',
      provider: EAuthProvider.Anthropic,
      secret: oauthSecret({ expiresInMs: 60_000 }),
    })

    await expect(
      broker.accessToken({ userId: USER, accountId: 'acc_refused' }),
    ).rejects.toBeInstanceOf(OAuthRefreshError)
  })

  it('404s on an account the user does not own', async () => {
    seedAccount({
      id: 'acc_theirs',
      provider: EAuthProvider.Anthropic,
      secret: oauthSecret({ expiresInMs: 3600_000 }),
    })

    await expect(
      broker.accessToken({ userId: 'user-2', accountId: 'acc_theirs' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
