import {
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
  type INestApplication,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import {
  EBootStep,
  EBootStepState,
  POD_EVENT_CONFLICT_CODE,
  SANDBOX_SELF_BOOT_STEPS_PATH,
  SANDBOX_SELF_EVENTS_PATH,
  SANDBOX_SELF_EVENTS_TRUNCATE_PATH,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import { eventsOf, seedSandboxRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { lockThread } from '../sessions/thread-head'
import { SandboxSelfController } from './sandbox-self.controller'
import { SandboxTokenGuard } from './sandbox-token.guard'
import { SandboxesService } from './sandboxes.service'
import { ETokenPrincipalKind } from './token-principal'
import { VercelSandboxClient } from './vercel-sandbox.client'

const SANDBOX_TOKEN = 'sandbox-token'
const POD_TOKEN = 'pod-token'

const vercel = {
  exposePort: vi.fn(
    async (_args: { threadId: string; name: string; port: number }) =>
      'https://atlas-5173.vercel.run',
  ),
  stopSession: vi.fn(
    async (_args: { threadId: string; name: string; sessionId?: string | undefined }) => undefined,
  ),
}

const as = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` })

describe('SandboxSelfController', () => {
  useTestDatabase()
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SandboxSelfController],
      providers: [
        SandboxTokenGuard,
        { provide: VercelSandboxClient, useValue: vercel },
        {
          provide: SandboxesService,
          useValue: {
            async verifyTokenPrincipal(query: { token: string }) {
              if (query.token === SANDBOX_TOKEN) {
                return {
                  kind: ETokenPrincipalKind.Sandbox,
                  id: 'sbx-1',
                  threadId: 'thr-1',
                  userId: 'usr-1',
                }
              }
              if (query.token === POD_TOKEN) {
                return { kind: ETokenPrincipalKind.Pod, threadId: 'thr-1', userId: 'usr-1' }
              }
              throw new UnauthorizedException()
            },
          },
        },
      ],
    }).compile()
    app = module.createNestApplication()
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await seedUsers('usr-1')
    await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', name: 'atlas-thread-1' })
    vercel.exposePort.mockClear()
    vercel.stopSession.mockClear()
  })

  it('lets a sandbox token expose a port on its own sandbox', async () => {
    const reply = await request(app.getHttpServer())
      .post('/v1/sandboxes/self/ports')
      .set(as(SANDBOX_TOKEN))
      .send({ port: 5173 })

    expect(reply.status).toBe(201)
    expect(reply.body).toEqual({ url: 'https://atlas-5173.vercel.run' })
    expect(vercel.exposePort).toHaveBeenCalledWith({
      threadId: 'thr-1',
      name: 'atlas-thread-1',
      port: 5173,
    })
  })

  it('rejects a port outside the valid range', async () => {
    const reply = await request(app.getHttpServer())
      .post('/v1/sandboxes/self/ports')
      .set(as(SANDBOX_TOKEN))
      .send({ port: 70_000 })

    expect(reply.status).toBe(400)
    expect(vercel.exposePort).not.toHaveBeenCalled()
  })

  it('stops the live session the token names, answering 204', async () => {
    const reply = await request(app.getHttpServer())
      .post('/v1/sandboxes/self/stop')
      .set(as(SANDBOX_TOKEN))
      .send({ sessionId: 'ses_live' })

    expect(reply.status).toBe(204)
    expect(vercel.stopSession).toHaveBeenCalledWith({
      threadId: 'thr-1',
      name: 'atlas-thread-1',
      sessionId: 'ses_live',
    })
  })

  it('stops with no body at all', async () => {
    const reply = await request(app.getHttpServer())
      .post('/v1/sandboxes/self/stop')
      .set(as(SANDBOX_TOKEN))

    expect(reply.status).toBe(204)
    expect(vercel.stopSession).toHaveBeenCalledWith({
      threadId: 'thr-1',
      name: 'atlas-thread-1',
      sessionId: undefined,
    })
  })

  it('answers 404 when the token names a thread with no sandbox row', async () => {
    await db.orm.public.CloudSandbox.where({ threadId: 'thr-1' }).delete()

    const reply = await request(app.getHttpServer())
      .post('/v1/sandboxes/self/ports')
      .set(as(SANDBOX_TOKEN))
      .send({ port: 5173 })

    expect(reply.status).toBe(404)
  })

  describe('boot steps', () => {
    const post = (token: string | undefined, body: unknown) => {
      const call = request(app.getHttpServer()).post(SANDBOX_SELF_BOOT_STEPS_PATH)
      return (token === undefined ? call : call.set(as(token))).send(body as object)
    }

    it('answers 401 with no token, an unknown token, or a pod token', async () => {
      const steps = [{ step: EBootStep.Clone, state: EBootStepState.Running }]
      const statuses = [
        (await post(undefined, { steps })).status,
        (await post('session-a', { steps })).status,
        (await post(POD_TOKEN, { steps })).status,
      ]
      expect(statuses).toEqual([401, 401, 401])
      expect(await db.orm.public.SandboxBootStep.all()).toEqual([])
    })

    it('answers 400 for a body that is not a boot-step batch', async () => {
      const bad = [
        {},
        { steps: [] },
        { steps: [{ step: 'nope', state: EBootStepState.Running }] },
        { steps: Array.from({ length: 51 }, () => ({ step: EBootStep.Clone, state: 'running' })) },
      ]
      for (const body of bad) expect((await post(SANDBOX_TOKEN, body)).status).toBe(400)
      expect(await db.orm.public.SandboxBootStep.all()).toEqual([])
    })

    it('writes the steps for the thread the token names and answers 204', async () => {
      await seedThreadRow({ id: 'thr-2', userId: 'usr-1' })

      const reply = await post(SANDBOX_TOKEN, {
        threadId: 'thr-2',
        steps: [
          { step: EBootStep.Clone, state: EBootStepState.Running },
          { step: EBootStep.Clone, state: EBootStepState.Error, error: 'no network' },
        ],
      })

      expect(reply.status).toBe(204)
      const rows = await db.orm.public.SandboxBootStep.all()
      expect(rows.map((row) => [row.threadId, row.step, row.state, row.error]).sort()).toEqual([
        ['thr-1', 'clone', 'error', 'no network'],
        ['thr-1', 'clone', 'running', null],
      ])
    })
  })

  describe('boot steps under the thread lock', () => {
    const agentRunning = { steps: [{ step: EBootStep.Agent, state: EBootStepState.Running }] }

    it('waits for a transaction holding the thread lock, then records', async () => {
      let release: () => void = () => undefined
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      let holding: () => void = () => undefined
      const held = new Promise<void>((resolve) => {
        holding = resolve
      })
      const holder = db.transaction(async (tx) => {
        await lockThread({ tx, threadId: 'thr-1' })
        holding()
        await released
      })
      await held

      let status: number | undefined
      const posting = request(app.getHttpServer())
        .post(SANDBOX_SELF_BOOT_STEPS_PATH)
        .set(as(SANDBOX_TOKEN))
        .send(agentRunning)
        .then((reply) => {
          status = reply.status
        })
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(status).toBeUndefined()
      expect(await db.orm.public.SandboxBootStep.all()).toEqual([])

      release()
      await holder
      await posting
      expect(status).toBe(204)
      expect(await db.orm.public.SandboxBootStep.all()).toHaveLength(1)
    })

    it('answers 404 and records nothing when the thread row is gone', async () => {
      await db.orm.public.Thread.where({ id: 'thr-1' }).delete()

      const reply = await request(app.getHttpServer())
        .post(SANDBOX_SELF_BOOT_STEPS_PATH)
        .set(as(SANDBOX_TOKEN))
        .send(agentRunning)

      expect(reply.status).toBe(404)
      expect(await db.orm.public.SandboxBootStep.all()).toEqual([])
    })
  })

  describe('pod events', () => {
    const podEvent = (seq: number) => ({
      seq,
      runId: 'run_pod',
      depth: 0,
      at: '2026-10-22T10:00:00.000Z',
      type: 'assistant-said',
      body: '{}',
    })
    const post = (path: string, token: string | undefined, body: unknown) => {
      const call = request(app.getHttpServer()).post(path)
      return (token === undefined ? call : call.set(as(token))).send(body as object)
    }

    it('answers 401 with no token or a pod token on both routes', async () => {
      for (const path of [SANDBOX_SELF_EVENTS_PATH, SANDBOX_SELF_EVENTS_TRUNCATE_PATH]) {
        expect((await post(path, undefined, {})).status).toBe(401)
        expect((await post(path, POD_TOKEN, {})).status).toBe(401)
      }
    })

    it('answers 400 for a malformed batch', async () => {
      for (const body of [{}, { events: [] }, { events: [{ seq: 0 }] }]) {
        expect((await post(SANDBOX_SELF_EVENTS_PATH, SANDBOX_TOKEN, body)).status).toBe(400)
      }
      expect(
        (await post(SANDBOX_SELF_EVENTS_TRUNCATE_PATH, SANDBOX_TOKEN, { toSeq: -1 })).status,
      ).toBe(400)
    })

    it("writes to the token's thread, never the body's, and replies with the head", async () => {
      await seedThreadRow({ id: 'thr-2', userId: 'usr-1' })

      const reply = await post(SANDBOX_SELF_EVENTS_PATH, SANDBOX_TOKEN, {
        threadId: 'thr-2',
        events: [podEvent(1), podEvent(2)],
      })

      expect(reply.status).toBe(201)
      expect(reply.body).toEqual({ head: 2 })
      expect(await eventsOf('thr-1')).toHaveLength(2)
      expect(await eventsOf('thr-2')).toHaveLength(0)
    })

    it('answers 409 with the conflict code and seq', async () => {
      await post(SANDBOX_SELF_EVENTS_PATH, SANDBOX_TOKEN, { events: [podEvent(1)] })

      const reply = await post(SANDBOX_SELF_EVENTS_PATH, SANDBOX_TOKEN, {
        events: [{ ...podEvent(1), body: '{"x":1}' }],
      })

      expect(reply.status).toBe(409)
      expect(reply.body).toMatchObject({ code: POD_EVENT_CONFLICT_CODE, seq: 1 })
    })

    it('truncates the token thread and replies with the head', async () => {
      await post(SANDBOX_SELF_EVENTS_PATH, SANDBOX_TOKEN, { events: [podEvent(1), podEvent(2)] })

      const reply = await post(SANDBOX_SELF_EVENTS_TRUNCATE_PATH, SANDBOX_TOKEN, { toSeq: 1 })

      expect(reply.status).toBe(201)
      expect(reply.body).toEqual({ head: 1 })
      expect(await eventsOf('thr-1')).toHaveLength(1)
    })
  })

  it('answers 401 with no token, an unknown token, or a pod token', async () => {
    for (const path of ['ports', 'stop']) {
      const bare = await request(app.getHttpServer())
        .post(`/v1/sandboxes/self/${path}`)
        .send({ port: 5173 })
      const unknown = await request(app.getHttpServer())
        .post(`/v1/sandboxes/self/${path}`)
        .set(as('session-a'))
        .send({ port: 5173 })
      const pod = await request(app.getHttpServer())
        .post(`/v1/sandboxes/self/${path}`)
        .set(as(POD_TOKEN))
        .send({ port: 5173 })
      expect([bare.status, unknown.status, pod.status]).toEqual([401, 401, 401])
    }
    expect(vercel.exposePort).not.toHaveBeenCalled()
    expect(vercel.stopSession).not.toHaveBeenCalled()
  })
})
