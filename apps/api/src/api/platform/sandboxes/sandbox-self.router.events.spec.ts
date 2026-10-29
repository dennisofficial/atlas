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

describe('SandboxSelfRouter events', () => {
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
    await seedSandboxRow({ threadId: 'thr-1', userId: 'usr-1', name: 'atlas-thread-1' })
  })

  describe('pod events', () => {
    it('answers 401 with no token on both routes', async () => {
      for (const procedure of ['events', 'truncateEvents']) {
        expect((await send(procedure, undefined, {})).status).toBe(401)
      }
    })

    it('answers 401 for a pod lease token on both routes', async () => {
      expect((await send('events', POD_TOKEN, { events: [podEvent(1)] })).status).toBe(401)
      expect((await send('truncateEvents', POD_TOKEN, { toSeq: 1 })).status).toBe(401)
      expect(await eventsOf('thr-1')).toHaveLength(0)
    })

    it('answers 400 for a malformed batch', async () => {
      for (const body of [{}, { events: [] }, { events: [{ seq: 0 }] }]) {
        expect((await send('events', SANDBOX_TOKEN, body)).status).toBe(400)
      }
      expect((await send('truncateEvents', SANDBOX_TOKEN, { toSeq: -1 })).status).toBe(400)
    })

    it('writes to the token thread when no threadId is given and replies with the head', async () => {
      const reply = await send('events', SANDBOX_TOKEN, { events: [podEvent(1), podEvent(2)] })

      expect(reply.status).toBe(200)
      expect(reply.body).toEqual({ result: { data: { head: 2 } } })
      expect(await eventsOf('thr-1')).toHaveLength(2)
    })

    it('routes a body threadId of a family member to that thread, in its own seq space', async () => {
      await seedThreadRow({ id: 'thr-2', userId: 'usr-1', spawnerThreadId: 'thr-1' })
      await seedThreadRow({ id: 'thr-3', userId: 'usr-1', spawnerThreadId: 'thr-2' })

      await send('events', SANDBOX_TOKEN, { events: [podEvent(1)] })
      const child = await send('events', SANDBOX_TOKEN, {
        threadId: 'thr-2',
        events: [podEvent(1), podEvent(2)],
      })
      const grandchild = await send('events', SANDBOX_TOKEN, {
        threadId: 'thr-3',
        events: [podEvent(1)],
      })

      expect(child.body).toEqual({ result: { data: { head: 2 } } })
      expect(grandchild.status).toBe(200)
      expect(await eventsOf('thr-1')).toHaveLength(1)
      expect(await eventsOf('thr-2')).toHaveLength(2)
      expect(await eventsOf('thr-3')).toHaveLength(1)
    })

    it('refuses a foreign or unrelated threadId and writes nothing', async () => {
      await seedUsers('usr-2')
      await seedThreadRow({ id: 'thr-other', userId: 'usr-1' })
      await seedThreadRow({ id: 'thr-foreign', userId: 'usr-2', spawnerThreadId: 'thr-1' })

      const unrelated = await send('events', SANDBOX_TOKEN, {
        threadId: 'thr-other',
        events: [podEvent(1)],
      })
      const foreign = await send('events', SANDBOX_TOKEN, {
        threadId: 'thr-foreign',
        events: [podEvent(1)],
      })
      const missing = await send('events', SANDBOX_TOKEN, {
        threadId: 'thr-nope',
        events: [podEvent(1)],
      })

      expect(unrelated.status).toBe(403)
      expect(foreign.status).toBe(403)
      expect(missing.status).toBe(404)
      expect(await eventsOf('thr-other')).toHaveLength(0)
      expect(await eventsOf('thr-foreign')).toHaveLength(0)
    })

    it('truncates a family member when a threadId is given', async () => {
      await seedThreadRow({ id: 'thr-2', userId: 'usr-1', spawnerThreadId: 'thr-1' })
      await send('events', SANDBOX_TOKEN, { threadId: 'thr-2', events: [podEvent(1), podEvent(2)] })

      const reply = await send('truncateEvents', SANDBOX_TOKEN, { threadId: 'thr-2', toSeq: 1 })

      expect(reply.body).toEqual({ result: { data: { head: 1 } } })
      expect(await eventsOf('thr-2')).toHaveLength(1)
    })

    it('answers 409 carrying the conflict code and seq in error.data.details', async () => {
      await send('events', SANDBOX_TOKEN, { events: [podEvent(1)] })

      const reply = await send('events', SANDBOX_TOKEN, {
        events: [{ ...podEvent(1), body: '{"x":1}' }],
      })

      expect(reply.status).toBe(409)
      expect(reply.body.error.data).toMatchObject({
        code: 'CONFLICT',
        httpStatus: 409,
        details: { code: POD_EVENT_CONFLICT_CODE, seq: 1 },
      })
    })

    it('truncates the token thread and replies with the head', async () => {
      await send('events', SANDBOX_TOKEN, {
        events: [podEvent(1), podEvent(2)],
      })

      const reply = await send('truncateEvents', SANDBOX_TOKEN, { toSeq: 1 })

      expect(reply.status).toBe(200)
      expect(reply.body).toEqual({ result: { data: { head: 1 } } })
      expect(await eventsOf('thr-1')).toHaveLength(1)
    })
  })
})
