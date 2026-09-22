import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb, type FakeConnectionRow } from '../../../../test/fake-factory-db.js'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { FactoryConnectionsService } from '../connections/connections.service'
import type { LinearConnectionCredentials } from './linear-credentials'
import { openCredentials, sealCredentials } from './linear-credentials'
import { LinearTokensService } from './linear-tokens.service'

const ENV = {
  LINEAR_CLIENT_ID: 'linear-client-id',
  LINEAR_CLIENT_SECRET: 'linear-client-secret',
  SECRETS_ENCRYPTION_KEY: 'a'.repeat(64),
}

function tokenResponse(args: { token: string; expiresIn: number; refreshToken?: string }): Response {
  return new Response(
    JSON.stringify({
      access_token: args.token,
      refresh_token: args.refreshToken,
      expires_in: args.expiresIn,
    }),
    { status: 200 },
  )
}

describe('LinearTokensService', () => {
  const fake = fakeFactoryDb()
  const cipher = new SecretCipherService(new EnvService(ENV))
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fake.reset()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function service(env: Record<string, string> = ENV): LinearTokensService {
    return new LinearTokensService(
      new EnvService(env),
      new FactoryConnectionsService(),
      new SecretCipherService(new EnvService(env)),
    )
  }

  function seal(credentials: LinearConnectionCredentials): string {
    return sealCredentials({ cipher, credentials })
  }

  function open(row: FakeConnectionRow | undefined): LinearConnectionCredentials {
    const credentials = openCredentials({ cipher, sealed: row?.sealedCredentials ?? '' })
    if (credentials === null) throw new Error('expected sealed credentials to open')
    return credentials
  }

  function seedConnection(overrides: Partial<FakeConnectionRow> = {}): void {
    fake.connections.push({
      id: 'fco_1',
      organizationId: 'org_compai',
      provider: 'linear',
      externalAccountId: 'ws-1',
      sealedCredentials: seal({
        accessToken: 'sealed-token',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + 3_600_000,
      }),
      scopes: 'read,write,app:assignable,app:mentionable',
      status: 'active',
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
      ...overrides,
    })
  }

  function seedExpired(): void {
    seedConnection({
      sealedCredentials: seal({
        accessToken: 'stale-token',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() - 1_000,
      }),
    })
  }

  it('refuses when the workspace has no connection', async () => {
    await expect(service().getToken({ workspaceId: 'ws-1' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a revoked connection', async () => {
    seedConnection({ status: 'revoked' })

    await expect(service().getToken({ workspaceId: 'ws-1' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the sealed access token while it is fresh, without a fetch', async () => {
    seedConnection()

    const token = await service().getToken({ workspaceId: 'ws-1' })

    expect(token).toBe('sealed-token')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('isolates tokens per workspace', async () => {
    seedConnection()
    fake.connections.push({
      id: 'fco_2',
      organizationId: 'org_other',
      provider: 'linear',
      externalAccountId: 'ws-2',
      sealedCredentials: seal({
        accessToken: 'other-token',
        refreshToken: 'refresh-2',
        expiresAt: Date.now() + 3_600_000,
      }),
      scopes: null,
      status: 'active',
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
    })
    const tokens = service()

    const first = await tokens.getToken({ workspaceId: 'ws-1' })
    const second = await tokens.getToken({ workspaceId: 'ws-2' })

    expect(first).toBe('sealed-token')
    expect(second).toBe('other-token')
  })

  it('refreshes an expired token through the refresh grant and reseals the connection', async () => {
    seedExpired()
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ token: 'token-2', expiresIn: 86399, refreshToken: 'refresh-2' }),
    )
    const tokens = service()

    const token = await tokens.getToken({ workspaceId: 'ws-1' })

    expect(token).toBe('token-2')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.linear.app/oauth/token')
    expect(init.body).toContain('grant_type=refresh_token')
    expect(init.body).toContain('refresh_token=refresh-1')
    expect(init.body).toContain('client_id=linear-client-id')
    expect(init.body).toContain('client_secret=linear-client-secret')

    const resealed = open(fake.connections[0])
    expect(resealed.accessToken).toBe('token-2')
    expect(resealed.refreshToken).toBe('refresh-2')
    expect(resealed.expiresAt).toBeGreaterThan(Date.now())

    const cached = await tokens.getToken({ workspaceId: 'ws-1' })
    expect(cached).toBe('token-2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('runs a single refresh for concurrent expired reads', async () => {
    seedExpired()
    fetchMock.mockResolvedValueOnce(tokenResponse({ token: 'token-2', expiresIn: 86399 }))
    const tokens = service()

    const [first, second] = await Promise.all([
      tokens.getToken({ workspaceId: 'ws-1' }),
      tokens.getToken({ workspaceId: 'ws-1' }),
    ])

    expect(first).toBe('token-2')
    expect(second).toBe('token-2')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous refresh token when the refresh response omits one', async () => {
    seedExpired()
    fetchMock.mockResolvedValueOnce(tokenResponse({ token: 'token-2', expiresIn: 86399 }))

    await service().getToken({ workspaceId: 'ws-1' })

    expect(open(fake.connections[0]).refreshToken).toBe('refresh-1')
  })

  it('refuses a connection that predates credential storage', async () => {
    seedConnection({ sealedCredentials: null })

    const failure = await service()
      .getToken({ workspaceId: 'ws-1' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ServiceUnavailableException)
    expect((failure as Error).message).toContain('reinstall')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a connection whose sealed blob does not hold credentials', async () => {
    seedConnection({ sealedCredentials: cipher.encrypt(JSON.stringify({ nope: true })) })

    const failure = await service()
      .getToken({ workspaceId: 'ws-1' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ServiceUnavailableException)
    expect((failure as Error).message).toContain('reinstall')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a connection whose sealed blob cannot be decrypted', async () => {
    seedConnection({ sealedCredentials: 'not-a-sealed-blob' })

    const failure = await service()
      .getToken({ workspaceId: 'ws-1' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ServiceUnavailableException)
    expect((failure as Error).message).toContain('reinstall')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an expired token that has no refresh token', async () => {
    seedConnection({
      sealedCredentials: seal({
        accessToken: 'stale-token',
        refreshToken: null,
        expiresAt: Date.now() - 1_000,
      }),
    })

    const failure = await service()
      .getToken({ workspaceId: 'ws-1' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ServiceUnavailableException)
    expect((failure as Error).message).toContain('reinstall')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('invalidate forces a refresh for the 401 path even while the sealed token looks fresh', async () => {
    seedConnection()
    const tokens = service()
    await tokens.getToken({ workspaceId: 'ws-1' })

    fetchMock.mockResolvedValueOnce(
      tokenResponse({ token: 'token-2', expiresIn: 86399, refreshToken: 'refresh-2' }),
    )
    tokens.invalidate({ workspaceId: 'ws-1' })

    const token = await tokens.getToken({ workspaceId: 'ws-1' })

    expect(token).toBe('token-2')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.body).toContain('grant_type=refresh_token')
    expect(open(fake.connections[0]).accessToken).toBe('token-2')
  })

  it('refuses to refresh when the oauth app is not configured', async () => {
    seedExpired()
    const unconfigured = service({ SECRETS_ENCRYPTION_KEY: ENV.SECRETS_ENCRYPTION_KEY })

    await expect(unconfigured.getToken({ workspaceId: 'ws-1' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a failed refresh throws without leaking the response body', async () => {
    seedExpired()
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant', secret: 'do-not-leak' }), {
        status: 400,
      }),
    )

    const failure = await service()
      .getToken({ workspaceId: 'ws-1' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).not.toContain('do-not-leak')
  })
})
