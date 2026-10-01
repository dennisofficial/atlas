import { randomUUID } from 'node:crypto'
import type { ExecutionContext, INestApplication } from '@nestjs/common'
import { UnauthorizedException, VersioningType } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaPg } from '@prisma/adapter-pg'
import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AuthenticatedRequest } from '../src/_core/types/auth.types'
import { SessionAuthGuard } from '../src/_module/session/session-auth.guard'
import { SandboxCheckpointController } from '../src/api/platform/sandboxes/sandbox-checkpoint.controller'
import { SandboxTokenGuard, type SandboxAuthenticatedRequest } from '../src/api/platform/sandboxes/sandbox-token.guard'
import { hashSessionToken } from '../src/api/platform/sandboxes/sandbox-tokens'
import { db } from '../src/db'
import { PrismaClient } from '../src/generated/prisma/client'

const DISPOSABLE_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55437/atlas_checkpoint_test'
const describeLive = process.env.ATLAS_LIVE_CHECKPOINT_DB === '1' ? describe : describe.skip

function validateDisposableDatabase(connectionString: string): void {
  const url = new URL(connectionString)
  if (
    url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
    url.port !== '55437' || url.username !== 'postgres' || url.password !== '' ||
    !/^\/atlas_checkpoint_test(?:_[a-z0-9_]+)?$/.test(url.pathname)
  ) throw new Error('Live checkpoint tests require the local disposable atlas_checkpoint_test database')
}

describeLive('runtime checkpoint CAS over HTTP and real PostgreSQL', () => {
  const runId = randomUUID()
  const ownerId = `checkpoint-owner-${runId}`
  const foreignId = `checkpoint-foreign-${runId}`
  const token = `synthetic-checkpoint-token-${runId}`
  const sandboxIds: string[] = []
  const threadIds: string[] = []
  let app: INestApplication | undefined
  let verificationDb: PrismaClient | undefined
  let fixture: { threadId: string; sandboxId: string }
  let previousDatabaseUrl: string | undefined

  function http() {
    if (app === undefined) throw new Error('Nest test app is not initialized')
    return request(app.getHttpServer())
  }

  function database(): PrismaClient {
    if (verificationDb === undefined) throw new Error('Verification database is not initialized')
    return verificationDb
  }

  function checkpoint(args: {
    revision: number
    phase?: ERuntimePhase
    digest?: string
  }): RuntimeCheckpoint {
    return {
      threadId: fixture.threadId,
      runtimeId: `runtime-${runId}`,
      sandboxSessionId: `session-${runId}`,
      revision: args.revision,
      phase: args.phase ?? ERuntimePhase.Running,
      reportedAt: new Date().toISOString(),
      transcript: {
        head: args.revision,
        count: args.revision,
        digest: args.digest ?? args.revision.toString(16).padStart(64, '0'),
      },
    }
  }

  function put(body: object) {
    return http().put(`/v1/sandboxes/${fixture.threadId}/checkpoint`)
      .set('authorization', `Bearer ${token}`).send(body)
  }

  async function expectPersisted(expected: RuntimeCheckpoint): Promise<void> {
    const row = await database().cloudSandbox.findUniqueOrThrow({ where: { id: fixture.sandboxId } })
    expect(row.runtimeCheckpointRevision).toBe(expected.revision)
    expect(row.runtimeCheckpoint).toEqual(expected)
    expect(row.state).toBe('running')
    expect(row.sandboxId).toBe(`provider-${fixture.sandboxId}`)
    expect(row.lastActivityAt).toBe('2026-10-01T00:00:00.000Z')
  }

  beforeAll(async () => {
    validateDisposableDatabase(DISPOSABLE_DATABASE_URL)
    previousDatabaseUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = DISPOSABLE_DATABASE_URL
    verificationDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: DISPOSABLE_DATABASE_URL }) })
    const identity = await database().$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`
    expect(identity).toEqual([{ database: 'atlas_checkpoint_test' }])
    await database().user.createMany({ data: [ownerId, foreignId].map(id => ({
      id, name: id, email: `${id}@checkpoint.invalid`,
    })) })

    const module = await Test.createTestingModule({ controllers: [SandboxCheckpointController] })
      .overrideGuard(SessionAuthGuard).useValue({
        canActivate(context: ExecutionContext): boolean {
          const req = context.switchToHttp().getRequest<AuthenticatedRequest>()
          const userId = req.headers['x-live-user']
          if (userId !== ownerId && userId !== foreignId) throw new UnauthorizedException()
          req.auth = { userId, sessionId: runId, email: `${userId}@checkpoint.invalid`, activeOrganizationId: null }
          return true
        },
      })
      .overrideGuard(SandboxTokenGuard).useValue({
        canActivate(context: ExecutionContext): boolean {
          const req = context.switchToHttp().getRequest<SandboxAuthenticatedRequest>()
          if (req.headers.authorization !== `Bearer ${token}`) throw new UnauthorizedException()
          req.sandbox = { threadId: fixture.threadId, userId: ownerId }
          return true
        },
      }).compile()
    app = module.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI })
    await app.listen(0, '127.0.0.1')
  }, 30_000)

  beforeEach(async () => {
    const threadId = `brn_checkpoint_${randomUUID()}`
    const sandboxId = `sbx_checkpoint_${randomUUID()}`
    fixture = { threadId, sandboxId }
    threadIds.push(threadId)
    sandboxIds.push(sandboxId)
    const at = '2026-10-01T00:00:00.000Z'
    await database().thread.create({ data: { id: threadId, userId: ownerId, createdAt: at, updatedAt: at } })
    await database().cloudSandbox.create({ data: {
      id: sandboxId, threadId, userId: ownerId, sandboxId: `provider-${sandboxId}`,
      name: sandboxId, region: 'iad1', state: 'running', tokenHash: hashSessionToken(token),
      lastActivityAt: at, createdAt: at, updatedAt: at,
    } })
  })

  afterAll(async () => {
    try {
      await app?.close()
      if (verificationDb !== undefined) {
        await verificationDb.cloudSandbox.deleteMany({ where: { id: { in: sandboxIds } } })
        await verificationDb.thread.deleteMany({ where: { id: { in: threadIds } } })
        await verificationDb.user.deleteMany({ where: { id: { in: [ownerId, foreignId] } } })
      }
    } finally {
      if (verificationDb !== undefined) {
        await Promise.all([verificationDb.$disconnect(), db.$disconnect()])
      }
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
    }
  })

  it('returns null for a missing checkpoint and does not disclose another owner’s row', async () => {
    const owner = await http().get(`/v1/sandboxes/${fixture.threadId}/checkpoint`)
      .set('x-live-user', ownerId).expect(200)
    expect(owner.body).toEqual({ checkpoint: null })
    await http().get(`/v1/sandboxes/${fixture.threadId}/checkpoint`)
      .set('x-live-user', foreignId).expect(404)
    const row = await database().cloudSandbox.findUniqueOrThrow({ where: { id: fixture.sandboxId } })
    expect(row.runtimeCheckpoint).toBeNull()
    expect(row.runtimeCheckpointRevision).toBeNull()
  })

  it('persists revisions 1 then 2 parked, rejecting replay and equal-revision replacement', async () => {
    const running = checkpoint({ revision: 1 })
    const parked = checkpoint({ revision: 2, phase: ERuntimePhase.Parked })
    expect((await put(running).expect(200)).body).toEqual({ checkpoint: running })
    await expectPersisted(running)
    expect((await put(parked).expect(200)).body).toEqual({ checkpoint: parked })
    await expectPersisted(parked)
    const stored = await database().cloudSandbox.findUniqueOrThrow({ where: { id: fixture.sandboxId } })

    const refused = [running, parked,
      checkpoint({ revision: 2, digest: 'f'.repeat(64) }),
      checkpoint({ revision: 2, phase: ERuntimePhase.Parked, digest: 'e'.repeat(64) })]
    for (const report of refused) {
      expect((await put(report).expect(200)).body).toEqual({ checkpoint: parked })
      await expectPersisted(parked)
      const unchanged = await database().cloudSandbox.findUniqueOrThrow({ where: { id: fixture.sandboxId } })
      expect(unchanged.updatedAt).toBe(stored.updatedAt)
    }
    const owner = await http().get(`/v1/sandboxes/${fixture.threadId}/checkpoint`)
      .set('x-live-user', ownerId).expect(200)
    expect(owner.body).toEqual({ checkpoint: parked })
    await http().get(`/v1/sandboxes/${fixture.threadId}/checkpoint`)
      .set('x-live-user', foreignId).expect(404)
  })

  it('atomically keeps the highest of 20 concurrent scrambled reports, including its exact digest and phase', async () => {
    const revisions = [11, 4, 18, 1, 15, 8, 3, 19, 6, 13, 2, 17, 10, 5, 20, 7, 16, 9, 14, 12]
    const reports = revisions.map(revision => checkpoint({
      revision, phase: revision === 20 ? ERuntimePhase.Parked : ERuntimePhase.Running,
    }))
    await Promise.all(reports.map(report => put(report).expect(200)))
    const highest = reports.find(report => report.revision === 20)
    if (highest === undefined) throw new Error('Highest revision fixture is missing')
    await expectPersisted(highest)
    const owner = await http().get(`/v1/sandboxes/${fixture.threadId}/checkpoint`)
      .set('x-live-user', ownerId).expect(200)
    expect(owner.body).toEqual({ checkpoint: highest })
  })

  it('rejects invalid payloads without writing a checkpoint', async () => {
    const valid = checkpoint({ revision: 1 })
    const invalid = [
      { phase: 'running' }, { ...valid, revision: 0 }, { ...valid, revision: 1.5 },
      { ...valid, phase: 'hibernated' }, { ...valid, threadId: `brn_foreign_${runId}` },
      { ...valid, transcript: { ...valid.transcript, digest: 'not-a-digest' } },
      { ...valid, unexpected: true },
    ]
    for (const body of invalid) await put(body).expect(400)
    const row = await database().cloudSandbox.findUniqueOrThrow({ where: { id: fixture.sandboxId } })
    expect(row.runtimeCheckpoint).toBeNull()
    expect(row.runtimeCheckpointRevision).toBeNull()
    expect(row.state).toBe('running')
  })

  it('allows the sandbox principal only on its own thread route', async () => {
    const foreignThread = `brn_foreign_${runId}`
    await http().put(`/v1/sandboxes/${foreignThread}/checkpoint`)
      .set('authorization', `Bearer ${token}`).send({ ...checkpoint({ revision: 1 }), threadId: foreignThread })
      .expect(401)
    await http().put(`/v1/sandboxes/${fixture.threadId}/checkpoint`)
      .send(checkpoint({ revision: 1 })).expect(401)
    expect((await put(checkpoint({ revision: 1 })).expect(200)).body.checkpoint.revision).toBe(1)
    expect(await database().cloudSandbox.count({ where: { threadId: foreignThread } })).toBe(0)
  })
})
