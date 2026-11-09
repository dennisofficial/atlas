import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { ThrottlerModule } from '@nestjs/throttler'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { TRPCModule } from 'nestjs-trpc'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { JSON_BODY_LIMIT } from '../../../_lib/body-limits'
import { ApiTrpcContext } from '../../../_module/trpc/api-trpc-context'
import { ApiTrpcModule } from '../../../_module/trpc/api-trpc.module'
import { HttpErrorMiddleware } from '../../../_module/trpc/http-error.middleware'
import { ThrottleMiddleware } from '../../../_module/trpc/throttle.middleware'
import { apiErrorFormatter } from '../../../_module/trpc/trpc-error-formatter'
import {
  fakeEnvModule,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { seedUsers } from '../../../../test/session-seed'
import { HostTokenMiddleware } from '../../platform/host/host-token.middleware'
import { HostMemoryRouter } from './host-memory.router'
import { MemoriesService } from './memories.service'

const HOST_TOKEN = 'host-token'
const THREAD = 'thr_memory'
const PROJECT_REPO = 'dennisofficial/atlas'

const createApp = async (): Promise<NestExpressApplication> => {
  const module = await Test.createTestingModule({
    imports: [
      fakeEnvModule(UNTHROTTLED_RATE_LIMIT, { AGENT_HOST_TOKEN: HOST_TOKEN }),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: UNTHROTTLED_RATE_LIMIT }]),
      ApiTrpcModule,
      TRPCModule.forRoot({
        basePath: '/v1/trpc',
        context: ApiTrpcContext,
        errorFormatter: apiErrorFormatter,
        globalMiddlewares: [HttpErrorMiddleware, ThrottleMiddleware],
      }),
    ],
    providers: [HostMemoryRouter, HostTokenMiddleware, MemoriesService],
  }).compile()
  const app = module.createNestApplication<NestExpressApplication>()
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT })
  await app.init()
  return app
}

const post = (args: {
  app: NestExpressApplication
  procedure: string
  body: unknown
}): request.Test =>
  request(args.app.getHttpServer())
    .post(`/v1/trpc/hostMemory.${args.procedure}`)
    .set({ authorization: `Bearer ${HOST_TOKEN}` })
    .send(args.body as object)

const globalMemory = {
  scope: 'global',
  name: 'dennis-prefers-bun',
  description: 'The workspace runs on Bun',
  type: 'user',
  body: 'Bun is the runtime.',
}

describe('HostMemoryRouter', () => {
  useTestDatabase()
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await seedUsers('usr-memory')
    await db.orm.public.Project.create({
      id: 'prj_memory',
      name: 'atlas',
      repo: PROJECT_REPO,
      ownerUserId: 'usr-memory',
    })
    await db.orm.v2.V2Session.create({
      id: 'ses_memory',
      userId: 'usr-memory',
      projectId: 'prj_memory',
      mainThreadId: THREAD,
      nextInboxId: 1,
      createdAt: new Date(),
    })
  })

  it('lists the global and project memories of the session owner', async () => {
    await post({ app, procedure: 'write', body: { threadId: THREAD, ...globalMemory } })
    await post({
      app,
      procedure: 'write',
      body: {
        threadId: THREAD,
        scope: 'project',
        name: 'v2-has-no-v1-imports',
        description: 'v2 must not import v1',
        type: 'project',
        body: 'Copy, never import.',
      },
    })
    const response = await post({ app, procedure: 'list', body: { threadId: THREAD } })
    expect(response.status).toBe(200)
    const data = response.body.result.data as {
      project: string | null
      memories: readonly { name: string; project: string | null }[]
    }
    expect(data.project).toBe(PROJECT_REPO)
    expect(data.memories.map((memory) => memory.name).sort()).toEqual([
      'dennis-prefers-bun',
      'v2-has-no-v1-imports',
    ])
    expect(data.memories.find((memory) => memory.name === 'v2-has-no-v1-imports')?.project).toBe(
      PROJECT_REPO,
    )
  })

  it('writes, reads, edits and removes a global memory', async () => {
    const written = await post({
      app,
      procedure: 'write',
      body: { threadId: THREAD, ...globalMemory },
    })
    expect(written.status).toBe(200)
    expect((written.body.result.data as { memory: { revision: number } }).memory.revision).toBe(1)

    const read = await post({
      app,
      procedure: 'get',
      body: { threadId: THREAD, scope: 'global', name: 'dennis-prefers-bun' },
    })
    expect((read.body.result.data as { memory: { body: string } }).memory.body).toBe(
      'Bun is the runtime.',
    )

    const edited = await post({
      app,
      procedure: 'edit',
      body: {
        threadId: THREAD,
        scope: 'global',
        name: 'dennis-prefers-bun',
        old: 'Bun is the runtime.',
        new: 'Bun is the runtime and the package manager.',
        revision: 1,
      },
    })
    expect((edited.body.result.data as { memory: { revision: number } }).memory.revision).toBe(2)

    const removed = await post({
      app,
      procedure: 'remove',
      body: { threadId: THREAD, scope: 'global', name: 'dennis-prefers-bun' },
    })
    expect(removed.body.result.data).toEqual({ removed: true })
    const again = await post({
      app,
      procedure: 'remove',
      body: { threadId: THREAD, scope: 'global', name: 'dennis-prefers-bun' },
    })
    expect(again.body.result.data).toEqual({ removed: false })
  })

  it('answers a missing memory with null rather than an error', async () => {
    const response = await post({
      app,
      procedure: 'get',
      body: { threadId: THREAD, scope: 'project', name: 'never-written' },
    })
    expect(response.status).toBe(200)
    expect(response.body.result.data).toEqual({ memory: null })
  })

  it('refuses a project-scope write when the session has no repository', async () => {
    await db.orm.public.Project.where({ id: 'prj_memory' }).update({ repo: null })
    const response = await post({
      app,
      procedure: 'write',
      body: { threadId: THREAD, ...globalMemory, scope: 'project', type: 'project' },
    })
    expect(response.status).toBe(400)
    expect(JSON.stringify(response.body)).toContain('only global memory is available')
  })

  it('refuses a stale edit', async () => {
    await post({ app, procedure: 'write', body: { threadId: THREAD, ...globalMemory } })
    const response = await post({
      app,
      procedure: 'edit',
      body: {
        threadId: THREAD,
        scope: 'global',
        name: 'dennis-prefers-bun',
        old: 'Bun',
        new: 'Deno',
        revision: 9,
      },
    })
    expect(response.status).toBe(409)
    expect(JSON.stringify(response.body)).toContain('read it again')
  })

  it('answers not found for a thread that does not exist', async () => {
    const response = await post({ app, procedure: 'list', body: { threadId: 'thr_nope' } })
    expect(response.status).toBe(404)
  })

  it('refuses a call without the host token', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/trpc/hostMemory.list')
      .send({ threadId: THREAD })
    expect(response.status).toBe(401)
  })
})
