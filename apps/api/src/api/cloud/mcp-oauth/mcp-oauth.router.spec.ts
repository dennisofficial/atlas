import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { SessionOrSandboxMiddleware } from '../../platform/sessions/session-or-sandbox.middleware'
import {
  createOauthApp,
  mutate,
  principalSandboxes,
  query,
  SANDBOX_PRINCIPALS,
  SESSIONS,
  sessionVerifier,
} from '../../platform/oauth-connections/oauth-connections.router.fixture'
import {
  FakeMcpClock,
  FakeMcpFetcher,
  FakeMcpStore,
  SERVER,
  TEST_CONFIG,
  installIssuer,
} from './mcp-oauth.fakes'
import { McpOauthAccessService } from './mcp-oauth-access.service'
import { McpOauthRouter } from './mcp-oauth.router'
import { McpOauthService } from './mcp-oauth.service'
import { McpOauthClock, McpOauthConfig, McpOauthFetcher, McpOauthStore } from './mcp-oauth.types'
import { sealJson } from './mcp-oauth-seal'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const NORMALIZED = new URL(SERVER).toString()

describe('McpOauthRouter authorization', () => {
  let app: NestExpressApplication
  let store: FakeMcpStore
  const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))

  beforeEach(async () => {
    store = new FakeMcpStore()
    const fetcher = new FakeMcpFetcher()
    installIssuer(fetcher)
    await store.upsertGrant({
      userId: 'user-a',
      serverUrl: NORMALIZED,
      sealed: sealJson({
        cipher,
        value: {
          clientInfo: { clientId: 'c' },
          tokens: {
            accessToken: 'tok-a',
            refreshToken: 'r',
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
          tokenEndpoint: 'https://auth.example.com/token',
          redirectUri: TEST_CONFIG.redirectUri,
        },
      }),
    })
    app = await createOauthApp([
      McpOauthRouter,
      McpOauthService,
      McpOauthAccessService,
      SessionMiddleware,
      SessionOrSandboxMiddleware,
      { provide: McpOauthStore, useValue: store },
      { provide: McpOauthClock, useValue: new FakeMcpClock(Date.now()) },
      { provide: McpOauthFetcher, useValue: fetcher },
      { provide: McpOauthConfig, useValue: TEST_CONFIG },
      { provide: SecretCipherService, useValue: cipher },
      { provide: SESSION_VERIFIER, useValue: sessionVerifier(SESSIONS) },
      {
        provide: SandboxesService,
        useValue: principalSandboxes({ principals: SANDBOX_PRINCIPALS }),
      },
    ])
  })

  afterEach(() => app.close())

  const body = { serverUrl: SERVER }

  it('keeps begin, status and disconnect session-only', async () => {
    expect((await mutate({ app, procedure: 'mcpOauth.begin', body })).status).toBe(401)
    expect(
      (await mutate({ app, procedure: 'mcpOauth.begin', token: 'sandbox-token-1', body })).status,
    ).toBe(401)
    expect(
      (
        await query({
          app,
          procedure: 'mcpOauth.status',
          token: 'sandbox-token-1',
          input: { serverUrls: [SERVER] },
        })
      ).status,
    ).toBe(401)
    expect(
      (await mutate({ app, procedure: 'mcpOauth.disconnect', token: 'sandbox-token-1', body }))
        .status,
    ).toBe(401)
  })

  it('reports status for the session user', async () => {
    const res = await query({
      app,
      procedure: 'mcpOauth.status',
      token: 'session-a',
      input: { serverUrls: [SERVER] },
    })
    expect(res.status).toBe(200)
    expect(res.body.result.data.grants[0].status).toBe('connected')
  })

  it('lets a sandbox mint a token scoped to its owner', async () => {
    const res = await mutate({
      app,
      procedure: 'mcpOauth.accessToken',
      token: 'sandbox-token-1',
      body,
    })
    expect(res.status).toBe(200)
    expect(res.body.result.data).toMatchObject({ outcome: 'granted', accessToken: 'tok-a' })
  })

  it('answers needs-auth to a different user', async () => {
    const res = await mutate({ app, procedure: 'mcpOauth.accessToken', token: 'session-b', body })
    expect(res.body.result.data).toEqual({ outcome: 'needs-auth' })
  })
})
