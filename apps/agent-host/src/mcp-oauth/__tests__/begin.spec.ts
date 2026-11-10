import { createHash } from 'node:crypto'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'

import { seedOwner } from '../../config/__tests__/config-reader.fixture'
import { mcpOauthGatewayOf } from '../gateway'
import type { McpOauthBegin } from '../types'
import {
  AUTH_ORIGIN,
  REDIRECT_URI,
  REGISTRATION_ENDPOINT,
  SERVER_URL,
  cipher,
  discoveryFetch,
  json,
  seedCloudServer,
  stubFetch,
} from './fixtures'

const testDb = useTestDatabase()

const beginUrlOf = (result: McpOauthBegin): URL => {
  if (!result.ok) throw new Error(`begin failed: ${result.reason}`)
  return new URL(result.url)
}

const gatewayOver = (db = testDb().db) =>
  mcpOauthGatewayOf({ db, cipher, publicUrl: 'https://agent.byatlas.io', allowLocalTargets: true })

const cloudArgs = {
  userId: 'user-1',
  projectId: 'proj-1',
  source: 'cloud' as const,
  name: 'posthog',
  url: SERVER_URL,
}

describe('begin', () => {
  it('writes a sealed pending row and answers an authorize url', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    stubFetch(discoveryFetch({ scopes: ['read', 'write'] }))

    const result = await gatewayOver(db).begin(cloudArgs)

    const url = beginUrlOf(result)
    const pending = await db.orm.public.McpOauthPending.all()
    expect(pending).toHaveLength(1)
    expect(url.origin).toBe(AUTH_ORIGIN)
    expect(url.pathname).toBe('/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge') ?? '').toHaveLength(43)
    const row = pending[0]
    if (row === undefined) throw new Error('no pending row')
    expect(url.searchParams.get('state')).toBe(row.id)
    expect(url.searchParams.get('resource')).toBe(SERVER_URL)
    expect(url.searchParams.get('scope')).toBe('read write')

    const sealed = JSON.parse(cipher.decrypt(row.sealed)) as {
      codeVerifier: string
      clientInfo: { clientId: string }
      tokenEndpoint: string
      redirectUri: string
    }
    const challenge = beginUrlOf(result).searchParams.get('code_challenge') ?? ''
    const expected = createHashOf(sealed.codeVerifier)
    expect(challenge).toBe(expected)
    expect(sealed.clientInfo.clientId).toBe('client-1')
    expect(sealed.tokenEndpoint).toBe(`https://auth.example.com/token`)
    expect(sealed.redirectUri).toBe(REDIRECT_URI)
    expect(row.serverUrl).toBe(SERVER_URL)
    expect(row.mcpServerId).toBe('srv-posthog')
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now())
    if (!result.ok) throw new Error('begin refused')
    expect(result.expiresAt).toBe(row.expiresAt.toISOString())
  })

  it('pins the resource to the server url when the metadata declares none', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    stubFetch(discoveryFetch({ resource: null }))

    const url = beginUrlOf(await gatewayOver(db).begin(cloudArgs))

    expect(url.searchParams.get('resource')).toBe(SERVER_URL)
  })

  it('sends no resource parameter when the server publishes no metadata', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    stubFetch(discoveryFetch({ protectedResource: false }))

    const url = beginUrlOf(await gatewayOver(db).begin(cloudArgs))

    expect(url.searchParams.get('resource')).toBeNull()
  })

  it('registers a client when the row has no reusable one', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    const { calls } = stubFetch(discoveryFetch())

    await gatewayOver(db).begin(cloudArgs)

    const registration = calls.find((call) => call.url === REGISTRATION_ENDPOINT)
    expect(registration?.method).toBe('POST')
    expect(JSON.parse(registration?.body ?? '{}')).toMatchObject({
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
    })
  })

  it('refuses with a reason when the server does not challenge', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    stubFetch(() => json({ result: 'ok' }))

    const result = await gatewayOver(db).begin(cloudArgs)

    expect(result).toEqual({ ok: false, reason: 'server does not require sign-in' })
    expect(await db.orm.public.McpOauthPending.all()).toEqual([])
  })

  it('refuses with a reason when the provider grants no registration', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedCloudServer({ db, name: 'posthog' })
    stubFetch(discoveryFetch({ registration: null }))

    const result = await gatewayOver(db).begin(cloudArgs)

    expect(result).toEqual({
      ok: false,
      reason: 'the server offers no dynamic client registration',
    })
    expect(await db.orm.public.McpOauthPending.all()).toEqual([])
  })

  it('refuses a cloud server that does not exist', async () => {
    const { db } = testDb()
    await seedOwner(db)
    stubFetch(discoveryFetch())

    const result = await gatewayOver(db).begin(cloudArgs)

    expect(result).toEqual({ ok: false, reason: 'mcp server not found' })
  })

  it('creates the repo-sourced row a repo begin is signing in', async () => {
    const { db } = testDb()
    await seedOwner(db)
    stubFetch(discoveryFetch())

    const result = await gatewayOver(db).begin({
      userId: 'user-1',
      projectId: 'proj-1',
      source: 'repo',
      name: 'swept',
      url: SERVER_URL,
    })

    beginUrlOf(result)
    const row = await db.orm.public.McpServer.first({ name: 'swept' })
    expect(row?.source).toBe('repo')
    expect(row?.repoUrl).toBe(SERVER_URL)
    expect(row?.lastSeenAt).toBeInstanceOf(Date)
    expect(row?.projectId).toBe('proj-1')
    expect(row?.sealedSpec).toBeNull()
    const pending = await db.orm.public.McpOauthPending.all()
    expect(pending[0]?.mcpServerId).toBe(row?.id ?? '')
    expect(pending[0]?.serverUrl).toBe(SERVER_URL)
  })
})

const createHashOf = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url')
