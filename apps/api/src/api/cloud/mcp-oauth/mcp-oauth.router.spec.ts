import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { EMcpServerSource } from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { InProcessRefreshLock, RefreshLock } from '../../../_lib/refresh-lock/refresh-lock'
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
import { EGrantRowStatus } from './mcp-oauth.types'
import type { ServerGrantRow } from './mcp-oauth.types'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const NORMALIZED = new URL(SERVER).toString()

const grantedServer = (cipher: SecretCipherService): ServerGrantRow => ({
  id: 'server-a',
  userId: 'user-a',
  projectId: null,
  name: 'posthog',
  source: EMcpServerSource.Cloud,
  sealedSpec: cipher.encrypt(
    JSON.stringify({ name: 'posthog', transport: { kind: 'http', url: SERVER } }),
  ),
  repoUrl: null,
  lastSeenAt: null,
  oauthServerUrl: NORMALIZED,
  oauthSealed: sealJson({
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
  oauthStatus: EGrantRowStatus.Active,
  oauthGeneration: 1,
  oauthRefreshAttempt: null,
  oauthRefreshStartedAt: null,
  oauthUpdatedAt: new Date(),
})

describe('McpOauthRouter authorization', () => {
  let app: NestExpressApplication
  let store: FakeMcpStore
  const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))

  beforeEach(async () => {
    store = new FakeMcpStore()
    const fetcher = new FakeMcpFetcher()
    installIssuer(fetcher)
    const server = grantedServer(cipher)
    store.servers.set(server.id, server)
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
      { provide: RefreshLock, useValue: new InProcessRefreshLock() },
      { provide: SecretCipherService, useValue: cipher },
      { provide: SESSION_VERIFIER, useValue: sessionVerifier(SESSIONS) },
      {
        provide: SandboxesService,
        useValue: principalSandboxes({ principals: SANDBOX_PRINCIPALS }),
      },
    ])
  })

  afterEach(() => app.close())

  const accessBody = { name: 'posthog', source: 'cloud', url: SERVER }

  it('keeps begin, servers and disconnect session-only', async () => {
    expect(
      (await mutate({ app, procedure: 'mcpOauth.begin', body: { serverId: 'server-a' } })).status,
    ).toBe(401)
    expect(
      (
        await mutate({
          app,
          procedure: 'mcpOauth.begin',
          token: 'sandbox-token-1',
          body: { serverId: 'server-a' },
        })
      ).status,
    ).toBe(401)
    expect(
      (await query({ app, procedure: 'mcpOauth.servers', token: 'sandbox-token-1', input: {} }))
        .status,
    ).toBe(401)
    expect(
      (
        await mutate({
          app,
          procedure: 'mcpOauth.disconnect',
          token: 'sandbox-token-1',
          body: { serverId: 'server-a' },
        })
      ).status,
    ).toBe(401)
  })

  it('reports servers for the session user', async () => {
    const res = await query({
      app,
      procedure: 'mcpOauth.servers',
      token: 'session-a',
      input: {},
    })
    expect(res.status).toBe(200)
    expect(res.body.result.data.servers).toHaveLength(1)
    expect(res.body.result.data.servers[0]).toMatchObject({
      id: 'server-a',
      name: 'posthog',
      status: 'connected',
    })
  })

  it('lets a sandbox mint a token scoped to its owner', async () => {
    const res = await mutate({
      app,
      procedure: 'mcpOauth.accessToken',
      token: 'sandbox-token-1',
      body: accessBody,
    })
    expect(res.status).toBe(200)
    expect(res.body.result.data).toMatchObject({ outcome: 'granted', accessToken: 'tok-a' })
  })

  it('answers needs-auth to a different user', async () => {
    const res = await mutate({
      app,
      procedure: 'mcpOauth.accessToken',
      token: 'session-b',
      body: accessBody,
    })
    expect(res.body.result.data).toEqual({ outcome: 'needs-auth' })
  })
})
