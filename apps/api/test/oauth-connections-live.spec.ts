import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { db } from '@dltech/atlas-db'
import { EOauthProvider } from '@dltech/atlas-wire'
import { seedThread, seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { EnvService } from '../src/_core/config/env/env.service'
import { SecretCipherService } from '../src/_lib/crypto/secret-cipher.service'
import { OauthConnectionsService } from '../src/api/platform/oauth-connections/oauth-connections.service'
import { OauthClock } from '../src/api/platform/oauth-connections/oauth-connections.types'
import { HttpOauthIssuer } from '../src/api/platform/oauth-connections/oauth-issuer'
import { PrismaOauthConnectionStore } from '../src/api/platform/oauth-connections/prisma-oauth-connection.store'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const HOUR = 3_600_000
const ISSUER_DELAY_MS = 300

class OffsetClock implements OauthClock {
  offsetMs = 0
  now(): number {
    return Date.now() + this.offsetMs
  }
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

describe('oauth connection authority over real PostgreSQL and a fake HTTP issuer', () => {
  const runId = randomUUID()
  const ownerId = `oauth-owner-${runId}`
  const foreignId = `oauth-foreign-${runId}`
  const realFetch = globalThis.fetch
  const clock = new OffsetClock()
  const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
  const instances = [0, 1].map(
    () =>
      new OauthConnectionsService(
        new PrismaOauthConnectionStore(),
        cipher,
        new HttpOauthIssuer(),
        clock,
      ),
  )
  const database = useTestDatabase()
  const connectionRow = (id: string) => db.orm.public.OauthConnection.first({ id })
  const assignmentCount = async (where: { connectionId: string } | { sandboxId: string }) =>
    (await db.orm.public.OauthConnectionSandbox.where(where).all()).length
  let issuerServer: Server
  let currentRefreshToken = ''
  let exchanges: string[] = []
  let failure: 'none' | 'invalid_grant' | 'drop' = 'none'

  const grant = (refreshToken: string) => ({
    accessToken: 'access-0',
    refreshToken,
    expiresAt: new Date(clock.now() + HOUR).toISOString(),
  })
  const upload = (connectionId: string, userId = ownerId) =>
    instances[0]!.upload({
      userId,
      connectionId,
      draft: { provider: EOauthProvider.Anthropic, tokens: grant(`refresh-${connectionId}-0`) },
    })
  const issue = (connectionId: string, via = 0, sandboxId?: string) =>
    instances[via]!.issueAccessToken({
      userId: ownerId,
      connectionId,
      ...(sandboxId === undefined ? {} : { sandboxId }),
    })
  const startNewConnection = async () => {
    const id = `conn-${randomUUID()}`
    currentRefreshToken = `refresh-${id}-0`
    exchanges = []
    failure = 'none'
    await upload(id)
    clock.offsetMs += HOUR
    return id
  }

  beforeEach(async () => {
    for (const id of [ownerId, foreignId]) await seedUser({ db: database().db, id })
  })

  beforeAll(async () => {
    issuerServer = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += String(chunk)
      })
      req.on('end', () => {
        const sent = (JSON.parse(raw) as { refresh_token?: string }).refresh_token ?? ''
        exchanges.push(sent)
        setTimeout(() => {
          if (failure === 'drop') return void req.socket.destroy()
          if (failure === 'invalid_grant' || sent !== currentRefreshToken) {
            res.writeHead(400).end(JSON.stringify({ error: 'invalid_grant' }))
            return
          }
          currentRefreshToken = `${sent}+`
          res.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              access_token: `access-${exchanges.length}-${randomUUID()}`,
              refresh_token: currentRefreshToken,
              expires_in: 3600,
            }),
          )
        }, ISSUER_DELAY_MS)
      })
    })
    await new Promise<void>((resolve) => issuerServer.listen(0, '127.0.0.1', resolve))
    const { port } = issuerServer.address() as { port: number }
    globalThis.fetch = ((input: string, init: RequestInit) =>
      realFetch(`http://127.0.0.1:${port}${new URL(input).pathname}`, init)) as typeof fetch
  }, 30_000)

  afterEach(() => {
    clock.offsetMs = 0
  })

  afterAll(async () => {
    globalThis.fetch = realFetch
    await new Promise((resolve) => issuerServer?.close(resolve))
  })

  it('performs exactly one provider exchange for concurrent callers on two instances', async () => {
    const id = await startNewConnection()
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => issue(id, i % 2)))

    expect(exchanges).toEqual([`refresh-${id}-0`])
    expect(new Set(results.map((dto) => dto.accessToken)).size).toBe(1)
    const row = await connectionRow(id)
    expect(row).toMatchObject({ generation: 1, refreshAttempt: null, refreshStartedAt: null })
    expect(row?.sealedTokens).not.toContain(`refresh-${id}`)
  })

  it('never rolls a replayed upload back over a rotated successor', async () => {
    const id = await startNewConnection()
    const successor = await issue(id)
    const replay = await upload(id)
    expect(replay).toMatchObject({ accessToken: successor.accessToken, generation: 1 })
    await expect(upload(id, foreignId)).rejects.toMatchObject({ status: 404 })
  })

  it('reauthorizes atomically, fencing an in-flight old refresh and refusing a delayed predecessor', async () => {
    const id = await startNewConnection()
    const reauthorize = (to: string, from: string) =>
      instances[1]!.reauthorize({
        userId: ownerId,
        connectionId: id,
        draft: {
          provider: EOauthProvider.Anthropic,
          tokens: { ...grant(`refresh-${to}`), accessToken: `access-${to}` },
          authorizationId: to,
          previousAuthorizationId: from,
        },
      })

    const inFlight = issue(id, 0)
    await new Promise((resolve) => setTimeout(resolve, ISSUER_DELAY_MS / 3))
    await expect(reauthorize('auth-2', id)).resolves.toMatchObject({ authorizationId: 'auth-2' })
    await expect(inFlight).resolves.toMatchObject({
      accessToken: 'access-auth-2',
      authorizationId: 'auth-2',
    })

    const row = await connectionRow(id)
    expect(row).toMatchObject({ authorizationId: 'auth-2', status: 'active', refreshAttempt: null })
    await expect(reauthorize('auth-2', id)).resolves.toMatchObject({ authorizationId: 'auth-2' })
    await expect(reauthorize('auth-3', id)).rejects.toMatchObject({ status: 409 })
  })

  it('leaves a persisted uncertain attempt that no instance retries', async () => {
    const id = await startNewConnection()
    failure = 'drop'
    await expect(issue(id)).rejects.toMatchObject({ status: 503 })
    failure = 'none'

    const row = await connectionRow(id)
    expect(row?.refreshAttempt).not.toBeNull()
    clock.offsetMs += 60_000
    await expect(issue(id, 1)).rejects.toMatchObject({ status: 409 })
    expect(exchanges).toHaveLength(1)
  })

  it('marks the connection expired after a definitive provider rejection', async () => {
    const id = await startNewConnection()
    failure = 'invalid_grant'
    await expect(issue(id)).rejects.toMatchObject({ status: 409 })
    const row = await connectionRow(id)
    expect(row).toMatchObject({ status: 'expired', refreshAttempt: null })
    await expect(issue(id, 1)).rejects.toMatchObject({ status: 409 })
    expect(exchanges).toHaveLength(1)
  })

  it('scopes sandbox issuance to assignments and cascades on sandbox and connection removal', async () => {
    const id = await startNewConnection()
    const at = new Date('2026-10-01T00:00:00.000Z')
    const sandboxes = [`sbx-${randomUUID()}`, `sbx-${randomUUID()}`]
    for (const sandboxId of sandboxes) {
      await seedThread({ db, id: `thr-${sandboxId}`, userId: ownerId })
      await db.orm.public.CloudSandbox.create({
        id: sandboxId,
        threadId: `thr-${sandboxId}`,
        userId: ownerId,
        sandboxId: `p-${sandboxId}`,
        name: sandboxId,
        region: 'iad1',
        state: 'running',
        tokenHash: sandboxId,
        lastActivityAt: at,
        createdAt: at,
        updatedAt: at,
      })
    }
    const [assigned, other] = sandboxes as [string, string]
    await expect(issue(id, 0, assigned)).rejects.toMatchObject({ status: 404 })
    await instances[0]!.assignSandbox({
      userId: ownerId,
      connectionId: id,
      threadId: `thr-${assigned}`,
    })
    await instances[1]!.assignSandbox({
      userId: ownerId,
      connectionId: id,
      threadId: `thr-${assigned}`,
    })
    await expect(issue(id, 1, assigned)).resolves.toMatchObject({ generation: 1 })
    await expect(issue(id, 1, other)).rejects.toMatchObject({ status: 404 })
    expect(await assignmentCount({ connectionId: id })).toBe(1)

    await db.orm.public.CloudSandbox.where({ id: assigned }).delete()
    expect(await assignmentCount({ connectionId: id })).toBe(0)
    await instances[0]!.assignSandbox({
      userId: ownerId,
      connectionId: id,
      threadId: `thr-${other}`,
    })
    await instances[0]!.remove({ userId: ownerId, connectionId: id })
    expect(await assignmentCount({ sandboxId: other })).toBe(0)
  })
})
