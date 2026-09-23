import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { FactoryConnectionsService } from '../connections/connections.service'
import type { LinearConnectionCredentials } from './linear-credentials'
import { LinearInstallService } from './linear-install.service'

const ENV = {
  LINEAR_CLIENT_ID: 'linear-client-id',
  LINEAR_CLIENT_SECRET: 'linear-client-secret',
  SECRETS_ENCRYPTION_KEY: 'a'.repeat(64),
}
const API_ORIGIN = 'https://api.byatlas.io'

function tokenResponse(args: { accessToken?: string } = {}): Response {
  return new Response(
    JSON.stringify({
      access_token: args.accessToken ?? 'app-actor-token',
      refresh_token: 'refresh-1',
      expires_in: 86399,
      scope: 'read write',
    }),
    { status: 200 },
  )
}

function organizationResponse(): Response {
  return new Response(JSON.stringify({ data: { organization: { id: 'ws-linear-1' } } }), {
    status: 200,
  })
}

describe('LinearInstallService', () => {
  const fake = fakeFactoryDb()
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fake.reset()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function service(env: Record<string, string> = ENV): LinearInstallService {
    return new LinearInstallService(
      new EnvService(env),
      new FactoryConnectionsService(),
      new SecretCipherService(new EnvService(env)),
    )
  }

  function openSealed(): LinearConnectionCredentials {
    const cipher = new SecretCipherService(new EnvService(ENV))
    return JSON.parse(
      cipher.decrypt(fake.connections[0]?.sealedCredentials ?? ''),
    ) as LinearConnectionCredentials
  }

  it('beginInstall refuses when the oauth app is not configured', () => {
    expect(() =>
      service({}).beginInstall({ organizationId: 'org_compai', apiOrigin: API_ORIGIN }),
    ).toThrow(ServiceUnavailableException)
  })

  it('beginInstall builds the authorize url with app actor and agent scopes', () => {
    const url = new URL(service().beginInstall({ organizationId: 'org_compai', apiOrigin: API_ORIGIN }))

    expect(url.origin + url.pathname).toBe('https://linear.app/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('linear-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(`${API_ORIGIN}/v1/factory/linear/callback`)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('read,write,app:assignable,app:mentionable')
    expect(url.searchParams.get('actor')).toBe('app')
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('completeInstall rejects an unknown state', async () => {
    await expect(
      service().completeInstall({ code: 'code-1', state: 'unknown', apiOrigin: API_ORIGIN }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('completeInstall exchanges the code and upserts the connection for the state organization', async () => {
    const install = service()
    const url = new URL(install.beginInstall({ organizationId: 'org_compai', apiOrigin: API_ORIGIN }))
    const state = url.searchParams.get('state') as string
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(organizationResponse())

    await install.completeInstall({ code: 'code-1', state, apiOrigin: API_ORIGIN })

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(tokenUrl).toBe('https://api.linear.app/oauth/token')
    expect(tokenInit.body).toContain('grant_type=authorization_code')
    expect(tokenInit.body).toContain('code=code-1')
    expect(fake.connections).toHaveLength(1)
    expect(fake.connections[0]).toMatchObject({
      provider: 'linear',
      externalAccountId: 'ws-linear-1',
      organizationId: 'org_compai',
      status: 'active',
      scopes: 'read,write,app:assignable,app:mentionable',
    })
  })

  it('completeInstall seals the workspace token into the connection, never in plaintext', async () => {
    const install = service()
    const url = new URL(install.beginInstall({ organizationId: 'org_compai', apiOrigin: API_ORIGIN }))
    const state = url.searchParams.get('state') as string
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(organizationResponse())

    await install.completeInstall({ code: 'code-1', state, apiOrigin: API_ORIGIN })

    const sealed = fake.connections[0]?.sealedCredentials ?? ''
    expect(sealed).not.toBe('')
    expect(sealed).not.toContain('app-actor-token')
    expect(sealed).not.toContain('refresh-1')

    const credentials = openSealed()
    expect(credentials.accessToken).toBe('app-actor-token')
    expect(credentials.refreshToken).toBe('refresh-1')
    expect(credentials.expiresAt).toBeGreaterThan(Date.now())
  })

  it('reinstalling the same workspace reseals the connection with the new token', async () => {
    const install = service()
    const first = new URL(install.beginInstall({ organizationId: 'org_compai', apiOrigin: API_ORIGIN }))
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(organizationResponse())
    await install.completeInstall({
      code: 'code-1',
      state: first.searchParams.get('state') as string,
      apiOrigin: API_ORIGIN,
    })

    const second = new URL(
      install.beginInstall({ organizationId: 'org_compai', apiOrigin: API_ORIGIN }),
    )
    fetchMock
      .mockResolvedValueOnce(tokenResponse({ accessToken: 'rotated-token' }))
      .mockResolvedValueOnce(organizationResponse())
    await install.completeInstall({
      code: 'code-2',
      state: second.searchParams.get('state') as string,
      apiOrigin: API_ORIGIN,
    })

    expect(fake.connections).toHaveLength(1)
    expect(openSealed().accessToken).toBe('rotated-token')
  })

  it('refuses to connect a workspace another organization already owns', async () => {
    const install = service()
    const first = new URL(install.beginInstall({ organizationId: 'org_compai', apiOrigin: API_ORIGIN }))
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(organizationResponse())
    await install.completeInstall({
      code: 'code-1',
      state: first.searchParams.get('state') as string,
      apiOrigin: API_ORIGIN,
    })

    const second = new URL(install.beginInstall({ organizationId: 'org_other', apiOrigin: API_ORIGIN }))
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(organizationResponse())
    const failure = await install
      .completeInstall({
        code: 'code-2',
        state: second.searchParams.get('state') as string,
        apiOrigin: API_ORIGIN,
      })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ConflictException)
    expect(fake.connections).toHaveLength(1)
    expect(fake.connections[0]?.organizationId).toBe('org_compai')
  })

  it('completeInstall consumes the state so a replay is rejected', async () => {
    const install = service()
    const url = new URL(install.beginInstall({ organizationId: 'org_compai', apiOrigin: API_ORIGIN }))
    const state = url.searchParams.get('state') as string
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(organizationResponse())

    await install.completeInstall({ code: 'code-1', state, apiOrigin: API_ORIGIN })
    await expect(
      install.completeInstall({ code: 'code-1', state, apiOrigin: API_ORIGIN }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('a failed token exchange throws without leaking the response body', async () => {
    const install = service()
    const url = new URL(install.beginInstall({ organizationId: 'org_compai', apiOrigin: API_ORIGIN }))
    const state = url.searchParams.get('state') as string
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant', token: 'do-not-leak' }), {
        status: 400,
      }),
    )

    const failure = await install
      .completeInstall({ code: 'code-1', state, apiOrigin: API_ORIGIN })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).not.toContain('do-not-leak')
    expect(fake.connections).toHaveLength(0)
  })
})
