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
import type { SealedGrant } from './mcp-oauth.types'

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

export const seedGrant = async (
  env: ReturnType<typeof build>,
  patch: Partial<SealedGrant['tokens']> = {},
  userId = 'user-a',
) => {
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
  await env.store.upsertGrant({
    userId,
    serverUrl: NORMALIZED,
    sealed: sealJson({ cipher: env.cipher, value: grant }),
  })
}

export const stateOf = (authorizationUrl: string) =>
  new URL(authorizationUrl).searchParams.get('state') ?? ''
