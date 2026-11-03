import { EMcpServerSource } from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import {
  AUTH,
  FakeMcpClock,
  FakeMcpFetcher,
  FakeMcpStore,
  SERVER,
  TEST_CONFIG,
  installIssuer,
} from './mcp-oauth.fakes'
import { McpOauthAccessService } from './mcp-oauth-access.service'
import { McpOauthService } from './mcp-oauth.service'
import { sealJson } from './mcp-oauth-seal'
import type { SealedGrant, ServerGrantRow } from './mcp-oauth.types'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
export const START = Date.parse('2026-10-30T12:00:00.000Z')
export const NORMALIZED = new URL(SERVER).toString()

export const build = (config = TEST_CONFIG) => {
  const store = new FakeMcpStore()
  const fetcher = new FakeMcpFetcher()
  const clock = new FakeMcpClock(START)
  const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
  const oauth = new McpOauthService(store, cipher, clock, fetcher, config)
  const access = new McpOauthAccessService(store, cipher, clock, fetcher, config)
  installIssuer(fetcher)
  return { store, fetcher, clock, cipher, oauth, access }
}

export const addCloudServer = async (
  env: ReturnType<typeof build>,
  args: {
    userId?: string | undefined
    projectId?: string | undefined
    projectOwner?: string | undefined
    name?: string | undefined
    url?: string | undefined
    headers?: Record<string, string> | undefined
  } = {},
): Promise<ServerGrantRow> => {
  const userId = args.userId === undefined ? 'user-a' : args.userId
  const projectId = args.projectId
  if (projectId !== undefined) {
    env.store.projectOwners.set(projectId, args.projectOwner ?? 'user-a')
  }
  const name = args.name ?? 'posthog'
  const url = args.url ?? SERVER
  const sealedSpec = env.cipher.encrypt(
    JSON.stringify({
      name,
      transport: {
        kind: 'http',
        url,
        ...(args.headers === undefined ? {} : { headers: args.headers }),
      },
    }),
  )
  const row: ServerGrantRow = {
    id: `server-${userId}-${projectId ?? ''}-${name}-${env.store.servers.size}`,
    userId: projectId === undefined ? userId : null,
    projectId: projectId ?? null,
    name,
    source: EMcpServerSource.Cloud,
    sealedSpec,
    repoUrl: null,
    lastSeenAt: null,
    oauthServerUrl: null,
    oauthSealed: null,
    oauthStatus: null,
    oauthGeneration: 0,
    oauthRefreshAttempt: null,
    oauthRefreshStartedAt: null,
    oauthUpdatedAt: null,
  }
  env.store.servers.set(row.id, row)
  return { ...row }
}

export const seedGrant = async (
  env: ReturnType<typeof build>,
  patch: Partial<SealedGrant['tokens']> = {},
  server?: ServerGrantRow,
) => {
  const row = server ?? (await addCloudServer(env))
  const grant: SealedGrant = {
    clientInfo: { clientId: 'client-1' },
    tokens: {
      accessToken: 'access-0',
      refreshToken: 'refresh-0',
      expiresAt: new Date(START + 3_600_000).toISOString(),
      ...patch,
    },
    tokenEndpoint: `${AUTH}/token`,
    redirectUri: TEST_CONFIG.redirectUri,
    resource: SERVER,
  }
  await env.store.writeGrant({
    id: row.id,
    serverUrl: NORMALIZED,
    sealed: sealJson({ cipher: env.cipher, value: grant }),
  })
  return row
}

export const accessArgs = (
  server: ServerGrantRow,
  args: { userId?: string; url?: string; rejectedAccessToken?: string } = {},
) => ({
  userId: args.userId ?? 'user-a',
  name: server.name,
  source: server.source,
  url: args.url ?? SERVER,
  ...(args.rejectedAccessToken === undefined
    ? {}
    : { rejectedAccessToken: args.rejectedAccessToken }),
})

export const stateOf = (authorizationUrl: string) =>
  new URL(authorizationUrl).searchParams.get('state') ?? ''
