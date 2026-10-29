import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  assertThreadInFamily,
  createSessionsRouterApp,
  mutate,
  pod,
  SANDBOX_THREAD,
  USER_ID,
  WIRE_THREAD,
} from './threads-routers.fixture'

const FIRST = { sendId: 'snd-1', text: 'hi' }
const AGENT = { spawnedBy: SANDBOX_THREAD, type: 'explore' }

const create = vi.fn(async () => WIRE_THREAD)
const open = vi.fn(async () => ({ thread: WIRE_THREAD, events: [] }))
const chooseModel = vi.fn(async () => undefined)
const launch = vi.fn(async () => ({ thread: WIRE_THREAD, provision: { state: 'booting' } }))

describe('ThreadsRouter under a pod token', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createSessionsRouterApp({
      threads: { create, open, chooseModel },
      launcher: { launch },
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    for (const fake of [create, open, chooseModel, launch, assertThreadInFamily]) {
      fake.mockClear()
    }
  })

  describe('create', () => {
    it('refuses a pod token that names no agent, and an anonymous caller', async () => {
      const body = { title: 'x' }

      expect((await mutate({ app, procedure: 'threads.create', headers: pod, body })).status).toBe(
        403,
      )
      expect((await mutate({ app, procedure: 'threads.create', body })).status).toBe(401)
      expect(create).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
    })

    it('lets a pod token create a sub-agent thread inside its family', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: pod,
        body: { agent: AGENT },
      })

      expect(reply.status).toBe(200)
      expect(create).toHaveBeenCalledTimes(1)
      expect(assertThreadInFamily).toHaveBeenCalledWith({
        sandboxThreadId: SANDBOX_THREAD,
        threadId: SANDBOX_THREAD,
      })
    })

    it('refuses a pod token spawning outside its family', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: pod,
        body: { agent: { spawnedBy: 'thr-other', type: 'explore' } },
      })

      expect(reply.status).toBe(401)
      expect(create).not.toHaveBeenCalled()
    })

    it('refuses a firstMessage or a client-chosen id from a pod token', async () => {
      for (const body of [
        { firstMessage: FIRST, agent: AGENT },
        { id: 'brn_fixed', agent: AGENT },
      ]) {
        const reply = await mutate({ app, procedure: 'threads.create', headers: pod, body })
        expect(reply.status).toBe(403)
      }
      expect(assertThreadInFamily).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
    })
  })

  describe('open', () => {
    it('lets a pod token open a sub-agent thread inside its family', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.open',
        headers: pod,
        body: { runId: 'run_1', drafts: [], id: 'brn_new', agent: AGENT },
      })

      expect(reply.status).toBe(200)
      expect(open).toHaveBeenCalledTimes(1)
      expect(assertThreadInFamily).toHaveBeenCalledWith({
        sandboxThreadId: SANDBOX_THREAD,
        threadId: SANDBOX_THREAD,
      })
    })
  })

  describe('chooseModel', () => {
    it('lets a pod token choose the model of its own thread', async () => {
      const body = { threadId: SANDBOX_THREAD, ref: 'anthropic/claude', effort: 'high' }
      const reply = await mutate({ app, procedure: 'threads.chooseModel', headers: pod, body })

      expect(reply.status).toBe(200)
      expect(chooseModel).toHaveBeenCalledWith({
        userId: USER_ID,
        threadId: SANDBOX_THREAD,
        draft: body,
      })
    })
  })
})
