import { EBootStep, EBootStepState, POD_EVENT_CONFLICT_CODE } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { eventsOf, seedSandboxRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { lockThread } from '../sessions/thread-head'
import {
  as,
  createSandboxSelfApp,
  POD_TOKEN,
  previews,
  procedurePath,
  SANDBOX_TOKEN,
  vercel,
} from './sandbox-self.router.fixture'

const post = ({
  app,
  procedure,
  token,
  body,
}: {
  app: INestApplication
  procedure: string
  token: string | undefined
  body?: unknown
}) => {
  const call = request(app.getHttpServer()).post(procedurePath(procedure))
  const authed = token === undefined ? call : call.set(as(token))
  return body === undefined ? authed : authed.send(body as object)
}

const podEvent = (seq: number) => ({
  seq,
  runId: 'run_pod',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'assistant-said',
  body: '{}',
})

describe('SandboxSelfRouter', () => {
  useTestDatabase()
  let app: INestApplication
  const send = (procedure: string, token: string | undefined, body?: unknown) =>
    post({ app, procedure, token, body })

  beforeAll(async () => {
    app = await createSandboxSelfApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await seedUsers('usr-1')
    await seedSandboxRow({
      threadId: 'thr-1',
      userId: 'usr-1',
      name: 'atlas-thread-1',
    })
    previews.expose.mockClear()
    vercel.stopSession.mockClear()
    vercel.renewDeadline.mockClear()
  })

  it('lets a sandbox token expose a port and returns the url and tunnel token', async () => {
    const reply = await send('exposePort', SANDBOX_TOKEN, { port: 5173 })

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({
      result: {
        data: {
          url: 'https://5173-abc.byatlas.dev',
          tunnelToken: 'tunnel-token',
        },
      },
    })
    expect(previews.expose).toHaveBeenCalledWith({
      threadId: 'thr-1',
      userId: 'usr-1',
      kind: 'sandbox',
      port: 5173,
    })
  })

  it('lets a pod token expose a port', async () => {
    const reply = await send('exposePort', POD_TOKEN, { port: 3000 })

    expect(reply.status).toBe(200)
    expect(previews.expose).toHaveBeenCalledWith({
      threadId: 'thr-1',
      userId: 'usr-1',
      kind: 'pod',
      port: 3000,
    })
  })

  it('rejects a port outside the valid range', async () => {
    const reply = await send('exposePort', SANDBOX_TOKEN, { port: 70_000 })

    expect(reply.status).toBe(400)
    expect(previews.expose).not.toHaveBeenCalled()
  })

  it('stops the live session the token names', async () => {
    const reply = await send('stop', SANDBOX_TOKEN, { sessionId: 'ses_live' })

    expect(reply.status).toBe(200)
    expect(vercel.stopSession).toHaveBeenCalledWith({
      threadId: 'thr-1',
      name: 'atlas-thread-1',
      sessionId: 'ses_live',
    })
  })

  it('renews the deadline of the session the token names', async () => {
    const reply = await send('renewDeadline', SANDBOX_TOKEN, {
      sessionId: 'ses_live',
      until: 2_000_000,
    })

    expect(reply.status).toBe(200)
    expect(vercel.renewDeadline).toHaveBeenCalledWith({
      threadId: 'thr-1',
      name: 'atlas-thread-1',
      sessionId: 'ses_live',
      until: 2_000_000,
    })
    expect(reply.body.result.data).toEqual({
      sessionId: 'ses_live',
      expiresAt: 2_000_000,
      startedAt: 1_000,
      extendedByMs: 5_000,
    })
  })

  it('stops with an empty body', async () => {
    const reply = await send('stop', SANDBOX_TOKEN, {})

    expect(reply.status).toBe(200)
    expect(vercel.stopSession).toHaveBeenCalledWith({
      threadId: 'thr-1',
      name: 'atlas-thread-1',
      sessionId: undefined,
    })
  })

  it('answers 401 with no token, an unknown token, or a pod token on sandbox-only routes', async () => {
    for (const procedure of ['stop', 'bootSteps']) {
      const body = {
        port: 5173,
        steps: [{ step: EBootStep.Clone, state: EBootStepState.Running }],
      }
      const statuses = [
        (await send(procedure, undefined, body)).status,
        (await send(procedure, 'session-a', body)).status,
        (await send(procedure, POD_TOKEN, body)).status,
      ]
      expect(statuses).toEqual([401, 401, 401])
    }
    expect(vercel.stopSession).not.toHaveBeenCalled()
    expect(await db.orm.public.SandboxBootStep.all()).toEqual([])
  })

  describe('boot steps', () => {
    it('answers 400 for a body that is not a boot-step batch', async () => {
      const bad = [
        {},
        { steps: [] },
        { steps: [{ step: 'nope', state: EBootStepState.Running }] },
        {
          steps: Array.from({ length: 51 }, () => ({
            step: EBootStep.Clone,
            state: 'running',
          })),
        },
      ]
      for (const body of bad)
        expect((await send('bootSteps', SANDBOX_TOKEN, body)).status).toBe(400)
      expect(await db.orm.public.SandboxBootStep.all()).toEqual([])
    })

    it('writes the steps for the thread the token names, never the body', async () => {
      await seedThreadRow({ id: 'thr-2', userId: 'usr-1' })

      const reply = await send('bootSteps', SANDBOX_TOKEN, {
        threadId: 'thr-2',
        steps: [
          { step: EBootStep.Clone, state: EBootStepState.Running },
          {
            step: EBootStep.Clone,
            state: EBootStepState.Error,
            error: 'no network',
          },
        ],
      })

      expect(reply.status).toBe(200)
      const rows = await db.orm.public.SandboxBootStep.all()
      expect(rows.map((row) => [row.sessionId, row.step, row.state, row.error]).sort()).toEqual([
        ['ses_thr-1', 'clone', 'error', 'no network'],
        ['ses_thr-1', 'clone', 'running', null],
      ])
    })

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
      const posting = send('bootSteps', SANDBOX_TOKEN, {
        steps: [{ step: EBootStep.Agent, state: EBootStepState.Running }],
      }).then((reply) => {
        status = reply.status
      })
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(status).toBeUndefined()
      expect(await db.orm.public.SandboxBootStep.all()).toEqual([])

      release()
      await holder
      await posting
      expect(status).toBe(200)
      expect(await db.orm.public.SandboxBootStep.all()).toHaveLength(1)
    })

    it('answers 404 and records nothing when the thread row is gone', async () => {
      await db.orm.public.Session.where({ id: 'ses_thr-1' }).delete()

      const reply = await send('bootSteps', SANDBOX_TOKEN, {
        steps: [{ step: EBootStep.Agent, state: EBootStepState.Running }],
      })

      expect(reply.status).toBe(404)
      expect(await db.orm.public.SandboxBootStep.all()).toEqual([])
    })
  })
})
