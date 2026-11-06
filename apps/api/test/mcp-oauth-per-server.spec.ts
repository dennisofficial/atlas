import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { seedThread, seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { seedProject } from '../src/test/web-settings.fake-db'
import { EMcpOauthAccessOutcome, EMcpOauthGrantStatus, EMcpServerSource } from '@dltech/atlas-wire'
import { describe, expect, it } from 'bun:test'
import { EnvService } from '../src/_core/config/env/env.service'
import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import { PgRefreshLock } from '../src/_lib/refresh-lock/pg-refresh-lock'
import { McpOauthAccessService } from '../src/api/cloud/mcp-oauth/mcp-oauth-access.service'
import { McpOauthService } from '../src/api/cloud/mcp-oauth/mcp-oauth.service'
import { FakeMcpFetcher } from '../src/api/cloud/mcp-oauth/mcp-oauth.fakes'
import { sealJson } from '../src/api/cloud/mcp-oauth/mcp-oauth-seal'
import { EGrantRowStatus, McpOauthClock } from '../src/api/cloud/mcp-oauth/mcp-oauth.types'
import type { SealedGrant } from '../src/api/cloud/mcp-oauth/mcp-oauth.types'
import { PrismaMcpOauthStore } from '../src/api/cloud/mcp-oauth/prisma-mcp-oauth.store'
import { McpServersService } from '../src/api/cloud/mcp-servers/mcp-servers.service'
import { EMcpTransportKind } from '../src/api/cloud/mcp-servers/mcp-servers.types'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const SERVER_URL = 'https://mcp.example.com/mcp'

class RealClock extends McpOauthClock {
  now() {
    return Date.now()
  }
}

describe('per-server mcp oauth over real PostgreSQL', () => {
  const runId = randomUUID()
  const ownerId = `owner-${runId}`
  const projectA = `proj-a-${runId}`
  const projectB = `proj-b-${runId}`
  const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
  const database = useTestDatabase()
  const config = {
    redirectUri: 'https://api.test/v1/mcp/oauth/callback',
    webOrigin: 'https://web.test',
    allowLocalTargets: true,
  }
  const services = () => {
    const store = new PrismaMcpOauthStore()
    const fetcher = new FakeMcpFetcher()
    return {
      store,
      oauth: new McpOauthService(store, cipher, new RealClock(), fetcher, config),
      access: new McpOauthAccessService(
        store,
        cipher,
        new RealClock(),
        fetcher,
        config,
        new PgRefreshLock(),
      ),
      servers: new McpServersService(cipher),
    }
  }
  const sealedTokens = (accessToken: string) =>
    sealJson({
      cipher,
      value: {
        clientInfo: { clientId: 'c' },
        tokens: { accessToken, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
        tokenEndpoint: 'https://auth.example.com/token',
        redirectUri: config.redirectUri,
      } satisfies SealedGrant,
    })
  const accessIn = (args: { name: string; threadId?: string }) => ({
    userId: ownerId,
    name: args.name,
    source: EMcpServerSource.Cloud,
    url: SERVER_URL,
    ...(args.threadId === undefined ? {} : { threadId: args.threadId }),
  })

  it('two project rows with the same url hold independent grants', async () => {
    await seedUser({ db: database().db, id: ownerId })
    await seedProject({ id: projectA, ownerUserId: ownerId })
    await seedProject({ id: projectB, ownerUserId: ownerId })
    const { store, oauth, access, servers } = services()
    await seedThread({
      db: database().db,
      id: `thr-a-${runId}`,
      userId: ownerId,
      projectId: projectA,
    })

    const putSpec = {
      transport: { kind: EMcpTransportKind.Http, url: SERVER_URL },
    }
    await db.orm.public.McpServer.create({
      id: `srv-a-${runId}`,
      projectId: projectA,
      source: 'cloud',
      name: 'posthog',
      sealedSpec: cipher.encrypt(JSON.stringify({ name: 'posthog', ...putSpec })),
    })
    await db.orm.public.McpServer.create({
      id: `srv-b-${runId}`,
      projectId: projectB,
      source: 'cloud',
      name: 'posthog',
      sealedSpec: cipher.encrypt(JSON.stringify({ name: 'posthog', ...putSpec })),
    })
    await store.writeGrant({
      id: `srv-a-${runId}`,
      serverUrl: new URL(SERVER_URL).toString(),
      sealed: sealedTokens('token-a'),
    })

    const listedA = await oauth.servers({ userId: ownerId, projectId: projectA })
    const listedB = await oauth.servers({ userId: ownerId, projectId: projectB })
    expect(listedA[0]?.status).toBe(EMcpOauthGrantStatus.Connected)
    expect(listedB[0]?.status).toBe(EMcpOauthGrantStatus.None)

    const granted = await access.accessToken(
      accessIn({ name: 'posthog', threadId: `thr-a-${runId}` }),
    )
    expect(granted).toMatchObject({
      outcome: EMcpOauthAccessOutcome.Granted,
      accessToken: 'token-a',
    })
    const outsideThread = await access.accessToken(accessIn({ name: 'posthog' }))
    expect(outsideThread.outcome).toBe(EMcpOauthAccessOutcome.NeedsAuth)
    expect(servers).toBeDefined()
  })

  it('concurrent first sightings of a repo server land on one row', async () => {
    await seedUser({ db: database().db, id: ownerId })
    await seedProject({ id: projectA, ownerUserId: ownerId })
    const { store } = services()
    const touch = () =>
      store.touchRepoServer({
        projectId: projectA,
        name: 'linear',
        url: SERVER_URL,
        now: new Date(),
      })

    const rows = await Promise.all([touch(), touch(), touch()])

    expect(new Set(rows.map((row) => row.id)).size).toBe(1)
    const stored = await db.orm.public.McpServer.where({ projectId: projectA }).all()
    expect(stored).toHaveLength(1)
  })

  it('fences claim, complete, release and reject on the generation and attempt', async () => {
    await seedUser({ db: database().db, id: ownerId })
    const { store } = services()
    await db.orm.public.McpServer.create({
      id: `srv-fence-${runId}`,
      userId: ownerId,
      source: 'cloud',
      name: 'fence',
      sealedSpec: cipher.encrypt(
        JSON.stringify({ name: 'fence', transport: { kind: 'http', url: SERVER_URL } }),
      ),
      oauthServerUrl: new URL(SERVER_URL).toString(),
      oauthSealed: sealedTokens('token-0'),
      oauthStatus: 'active',
      oauthUpdatedAt: new Date(),
    })
    const id = `srv-fence-${runId}`
    const claimArgs = {
      id,
      generation: 0,
      attemptId: 'attempt-1',
      startedAt: new Date(),
    }
    expect(await store.claim(claimArgs)).toBe(true)
    expect(await store.claim({ ...claimArgs, attemptId: 'attempt-0' })).toBe(true)
    expect(await store.complete({ id, attemptId: 'attempt-1', generation: 0, sealed: 'x' })).toBe(
      false,
    )
    expect(await store.claim(claimArgs)).toBe(true)
    expect(await store.claim({ ...claimArgs, generation: 9 })).toBe(false)

    expect(
      await store.complete({ id, attemptId: 'other', generation: 0, sealed: 'sealed-1' }),
    ).toBe(false)
    expect(
      await store.complete({ id, attemptId: 'attempt-1', generation: 0, sealed: 'sealed-1' }),
    ).toBe(true)
    const completed = await db.orm.public.McpServer.first({ id })
    expect(completed).toMatchObject({
      oauthSealed: 'sealed-1',
      oauthGeneration: 1,
      oauthRefreshAttempt: null,
    })

    await db.orm.public.McpServer.where({ id }).updateAndCount({
      oauthRefreshAttempt: 'attempt-2',
      oauthRefreshStartedAt: new Date(),
    })
    expect(await store.release({ id, attemptId: 'attempt-2', generation: 1 })).toBe(true)
    expect(await store.release({ id, attemptId: 'attempt-2', generation: 1 })).toBe(false)

    await db.orm.public.McpServer.where({ id }).updateAndCount({
      oauthRefreshAttempt: 'attempt-3',
      oauthRefreshStartedAt: new Date(),
    })
    expect(await store.reject({ id, attemptId: 'attempt-3', generation: 1 })).toBe(true)
    const rejected = await db.orm.public.McpServer.first({ id })
    expect(rejected).toMatchObject({ oauthStatus: 'expired', oauthRefreshAttempt: null })
    expect(await store.claim({ ...claimArgs, generation: 1, attemptId: 'attempt-4' })).toBe(false)
  })

  it('a cloud put that changes the url clears the grant, same url keeps it', async () => {
    await seedUser({ db: database().db, id: ownerId })
    const { store, servers } = services()
    await servers.put({
      userId: ownerId,
      name: 'posthog',
      spec: { transport: { kind: EMcpTransportKind.Http, url: SERVER_URL } },
    })
    const row = await store.findByName({
      userId: ownerId,
      source: EMcpServerSource.Cloud,
      name: 'posthog',
    })
    if (row === null) throw new Error('no server')
    await store.writeGrant({
      id: row.id,
      serverUrl: new URL(SERVER_URL).toString(),
      sealed: sealedTokens('token-1'),
    })

    await servers.put({
      userId: ownerId,
      name: 'posthog',
      spec: {
        transport: {
          kind: EMcpTransportKind.Http,
          url: SERVER_URL,
          headers: { 'x-team': 'atlas' },
        },
      },
    })
    const kept = await store.findServer({ id: row.id })
    expect(kept?.oauthStatus).toBe(EGrantRowStatus.Active)
    expect(kept?.oauthSealed).not.toBeNull()

    await servers.put({
      userId: ownerId,
      name: 'posthog',
      spec: { transport: { kind: EMcpTransportKind.Http, url: 'https://other.example.com/mcp' } },
    })
    const cleared = await store.findServer({ id: row.id })
    expect(cleared?.oauthServerUrl).toBeNull()
    expect(cleared?.oauthSealed).toBeNull()
    expect(cleared?.oauthStatus).toBeNull()
    expect(cleared?.oauthGeneration).toBe(2)
  })
})
