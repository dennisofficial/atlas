import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { EMcpOauthAccessOutcome, EMcpServerSource } from '@dltech/atlas-wire'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { EnvService } from '../src/_core/config/env/env.service'
import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import { PgRefreshLock } from '../src/_lib/refresh-lock/pg-refresh-lock'
import { McpOauthAccessService } from '../src/api/cloud/mcp-oauth/mcp-oauth-access.service'
import { sealJson, type SealedGrant } from '../src/agent'
import { McpOauthClock, type McpOauthFetcher } from '../src/api/cloud/mcp-oauth/mcp-oauth.types'
import { PrismaMcpOauthStore } from '../src/api/cloud/mcp-oauth/prisma-mcp-oauth.store'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const SERVER_URL = 'https://mcp.example.com/mcp'

class RealClock extends McpOauthClock {
  now() {
    return Date.now()
  }
}

const grantPayload = (tokenEndpoint: string, redirectUri: string): SealedGrant => ({
  clientInfo: { clientId: 'c' },
  tokens: {
    accessToken: 'stale',
    refreshToken: 'refresh-0',
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  },
  tokenEndpoint,
  redirectUri,
})

describe('mcp oauth grants over real PostgreSQL', () => {
  const runId = randomUUID()
  const ownerId = `mcp-owner-${runId}`
  const foreignId = `mcp-foreign-${runId}`
  const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
  const database = useTestDatabase()
  const redirectUri = 'http://localhost/cb'
  const config = { allowLocalTargets: true }
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
          new PgRefreshLock(),
        ),
    )

  const seedGrantedServer = async (args: {
    id: string
    userId: string
    name: string
    serverUrl: string
  }) => {
    await db.orm.public.McpServer.create({
      id: args.id,
      userId: args.userId,
      source: 'cloud',
      name: args.name,
      sealedSpec: cipher.encrypt(
        JSON.stringify({ name: args.name, transport: { kind: 'http', url: args.serverUrl } }),
      ),
    })
    await new PrismaMcpOauthStore().writeGrant({
      id: args.id,
      serverUrl: new URL(args.serverUrl).toString(),
      sealed: sealJson({ cipher, value: grantPayload(tokenEndpoint, redirectUri) }),
    })
  }

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
    await seedGrantedServer({
      id: `srv-${runId}`,
      userId: ownerId,
      name: 'posthog',
      serverUrl: SERVER_URL,
    })
  })

  it('refreshes once under concurrency across instances and isolates owners', async () => {
    const [a, b] = instances({ fetch: (input, init) => fetch(input, init) })
    const accessArgs = { name: 'posthog', source: EMcpServerSource.Cloud, url: SERVER_URL }
    const results = await Promise.all([
      a!.accessToken({ userId: ownerId, ...accessArgs }),
      b!.accessToken({ userId: ownerId, ...accessArgs }),
      a!.accessToken({ userId: ownerId, ...accessArgs }),
    ])
    expect(exchanges).toBe(1)
    for (const result of results) {
      expect(result).toMatchObject({
        outcome: EMcpOauthAccessOutcome.Granted,
        accessToken: 'fresh-1',
      })
    }
    const row = await db.orm.public.McpServer.first({ id: `srv-${runId}` })
    expect(row?.oauthGeneration).toBe(2)
    expect(row?.oauthRefreshAttempt).toBeNull()

    const foreign = await a!.accessToken({ userId: foreignId, ...accessArgs })
    expect(foreign.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
  })
})
