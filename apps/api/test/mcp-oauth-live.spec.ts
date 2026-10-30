import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { EMcpOauthAccessOutcome, EMcpOauthBeginOutcome } from '@dltech/atlas-wire'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { EnvService } from '../src/_core/config/env/env.service'
import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import { McpOauthService } from '../src/api/cloud/mcp-oauth/mcp-oauth.service'
import {
  FakeMcpFetcher,
  AUTH,
  SERVER as FAKE_SERVER,
  installIssuer,
  json,
} from '../src/api/cloud/mcp-oauth/mcp-oauth.fakes'
import { McpOauthAccessService } from '../src/api/cloud/mcp-oauth/mcp-oauth-access.service'
import { sealJson } from '../src/api/cloud/mcp-oauth/mcp-oauth-seal'
import { McpOauthClock, type McpOauthFetcher } from '../src/api/cloud/mcp-oauth/mcp-oauth.types'
import type { SealedGrant } from '../src/api/cloud/mcp-oauth/mcp-oauth.types'
import { PrismaMcpOauthStore } from '../src/api/cloud/mcp-oauth/prisma-mcp-oauth.store'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const SERVER_URL = 'https://mcp.example.com/mcp'

class RealClock extends McpOauthClock {
  now() {
    return Date.now()
  }
  sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }
}

describe('mcp oauth grants over real PostgreSQL', () => {
  const runId = randomUUID()
  const ownerId = `mcp-owner-${runId}`
  const foreignId = `mcp-foreign-${runId}`
  const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
  const database = useTestDatabase()
  const config = {
    redirectUri: 'http://localhost/cb',
    webOrigin: 'http://localhost',
    allowLocalTargets: true,
  }
  let issuer: Server
  let tokenEndpoint = ''
  let exchanges = 0

  const instances = (fetcher: McpOauthFetcher) =>
    [0, 1].map(
      () =>
        new McpOauthAccessService(
          new PrismaMcpOauthStore(),
          cipher,
          new RealClock(),
          fetcher,
          config,
        ),
    )

  beforeAll(async () => {
    issuer = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        exchanges += 1
        setTimeout(() => {
          res.setHeader('content-type', 'application/json')
          res.end(
            JSON.stringify({
              access_token: `fresh-${exchanges}`,
              refresh_token: `refresh-${exchanges}`,
              expires_in: 3600,
            }),
          )
        }, 300)
      })
    })
    await new Promise<void>((resolve) => issuer.listen(0, '127.0.0.1', resolve))
    tokenEndpoint = `http://127.0.0.1:${(issuer.address() as AddressInfo).port}/token`
  })

  afterAll(() => {
    issuer.close()
  })

  beforeEach(async () => {
    exchanges = 0
    for (const id of [ownerId, foreignId]) await seedUser({ db: database().db, id })
    const grant: SealedGrant = {
      clientInfo: { clientId: 'c' },
      tokens: {
        accessToken: 'stale',
        refreshToken: 'refresh-0',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      tokenEndpoint,
      redirectUri: config.redirectUri,
    }
    await new PrismaMcpOauthStore().upsertGrant({
      userId: ownerId,
      serverUrl: new URL(SERVER_URL).toString(),
      sealed: sealJson({ cipher, value: grant }),
    })
  })

  it('refreshes once under concurrency across instances and isolates owners', async () => {
    const [a, b] = instances({ fetch: (input, init) => fetch(input, init) })
    const results = await Promise.all([
      a!.accessToken({ userId: ownerId, serverUrl: SERVER_URL }),
      b!.accessToken({ userId: ownerId, serverUrl: SERVER_URL }),
      a!.accessToken({ userId: ownerId, serverUrl: SERVER_URL }),
    ])
    expect(exchanges).toBe(1)
    for (const result of results) {
      expect(result).toMatchObject({
        outcome: EMcpOauthAccessOutcome.Granted,
        accessToken: 'fresh-1',
      })
    }
    const row = await db.orm.public.McpOauthGrant.first({ userId: ownerId })
    expect(row?.generation).toBe(1)
    expect(row?.refreshAttempt).toBeNull()

    const foreign = await a!.accessToken({ userId: foreignId, serverUrl: SERVER_URL })
    expect(foreign.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
  })

  it('reuses the registered client on a second begin against real Postgres', async () => {
    const fetcher = new FakeMcpFetcher()
    installIssuer(fetcher)
    fetcher.on(`${AUTH}/token`, () =>
      json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }),
    )
    const service = new McpOauthService(
      new PrismaMcpOauthStore(),
      cipher,
      new RealClock(),
      fetcher,
      {
        redirectUri: 'https://web.test/v1/mcp/oauth/callback',
        webOrigin: 'https://web.test',
        allowLocalTargets: false,
        resolveHost: async () => ['93.184.216.34'],
      },
    )
    const first = await service.begin({ userId: ownerId, serverUrl: FAKE_SERVER })
    expect(first.outcome).toBe(EMcpOauthBeginOutcome.Redirect)
    const state = new URL(
      first.outcome === EMcpOauthBeginOutcome.Redirect ? first.authorizationUrl : '',
    ).searchParams.get('state')
    await service.complete({ state: state ?? '', code: 'c', sessionUserId: ownerId })
    const second = await service.begin({ userId: ownerId, serverUrl: FAKE_SERVER })
    expect(second.outcome).toBe(EMcpOauthBeginOutcome.Redirect)
    expect(fetcher.callsTo(`${AUTH}/register`)).toHaveLength(1)
  })
})
