import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  assertThreadInFamily,
  CHILD_THREAD,
  createSessionsRouterApp,
  mutate,
  pod,
  sandbox,
  SANDBOX_THREAD,
  session,
  USER_ID,
  WIRE_THREAD,
} from './threads-routers.fixture'

const FIRST = { sendId: 'snd-1', text: 'hi' }
const AGENT = { spawnedBy: SANDBOX_THREAD, type: 'explore' }

const create = vi.fn(async () => WIRE_THREAD)
const open = vi.fn(async () => ({ thread: WIRE_THREAD, events: [] }))
const launch = vi.fn(async () => ({ thread: WIRE_THREAD, provision: { state: 'booting' } }))

describe('ThreadsRouter', () => {
  let app: NestExpressApplication
  const as = { session, sandbox, pod }

  beforeAll(async () => {
    app = await createSessionsRouterApp({
      threads: { create, open },
      launcher: { launch },
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    for (const fake of [create, open, launch, assertThreadInFamily]) {
      fake.mockClear()
    }
  })

  describe('create', () => {
    it('refuses a firstMessage from a sandbox token before anything else runs', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: as.sandbox,
        body: { firstMessage: FIRST, agent: AGENT },
      })

      expect(reply.status).toBe(403)
      expect(assertThreadInFamily).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
    })

    it('launches a user session create that carries a firstMessage', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: as.session,
        body: { firstMessage: FIRST, title: 'x' },
      })

      expect(reply.status).toBe(200)
      expect(reply.body.result.data.provision).toEqual({ state: 'booting' })
      expect(launch).toHaveBeenCalledWith({
        userId: USER_ID,
        draft: { firstMessage: FIRST, title: 'x' },
        firstMessage: FIRST,
      })
      expect(create).not.toHaveBeenCalled()
    })

    it('hands a client-chosen id with the firstMessage to the launcher', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: as.session,
        body: { id: 'brn_fixed', firstMessage: FIRST },
      })

      expect(reply.status).toBe(200)
      expect(launch).toHaveBeenCalledWith({
        userId: USER_ID,
        draft: { id: 'brn_fixed', firstMessage: FIRST },
        firstMessage: FIRST,
      })
    })

    it('creates a plain thread under a client-chosen id when there is no firstMessage', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: as.session,
        body: { id: 'brn_fixed', title: 'x' },
      })

      expect(reply.status).toBe(200)
      expect(create).toHaveBeenCalledWith({
        userId: USER_ID,
        draft: { id: 'brn_fixed', title: 'x' },
      })
      expect(launch).not.toHaveBeenCalled()
    })

    it('refuses a client-chosen id from a sandbox token before anything else runs', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: as.sandbox,
        body: { id: 'brn_fixed', agent: AGENT },
      })

      expect(reply.status).toBe(403)
      expect(assertThreadInFamily).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
    })

    it('rejects an empty client-chosen id', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: as.session,
        body: { id: '', firstMessage: FIRST },
      })

      expect(reply.status).toBe(400)
      expect(launch).not.toHaveBeenCalled()
    })

    it('creates a plain thread for a session with no firstMessage', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: as.session,
        body: { title: 'x' },
      })

      expect(reply.status).toBe(200)
      expect(reply.body.result.data).toEqual(WIRE_THREAD)
      expect(create).toHaveBeenCalledWith({ userId: USER_ID, draft: { title: 'x' } })
    })

    it('refuses a sandbox token that names no agent', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: as.sandbox,
        body: {},
      })

      expect(reply.status).toBe(403)
      expect(create).not.toHaveBeenCalled()
    })

    it('lets a sandbox token spawn a sub-agent inside its family', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: as.sandbox,
        body: { agent: { spawnedBy: CHILD_THREAD, type: 'explore' } },
      })

      expect(reply.status).toBe(200)
      expect(assertThreadInFamily).toHaveBeenCalledWith({
        sandboxThreadId: SANDBOX_THREAD,
        threadId: CHILD_THREAD,
      })
      expect(create).toHaveBeenCalledTimes(1)
    })

    it('refuses a sandbox token spawning outside its family', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: as.sandbox,
        body: { agent: { spawnedBy: 'thr-other', type: 'explore' } },
      })

      expect(reply.status).toBe(401)
      expect(create).not.toHaveBeenCalled()
    })

    it('refuses a pod token and an anonymous caller', async () => {
      const body = { title: 'x' }

      expect(
        (await mutate({ app, procedure: 'threads.create', headers: as.pod, body })).status,
      ).toBe(403)
      expect((await mutate({ app, procedure: 'threads.create', body })).status).toBe(401)
    })

    it('rejects an invalid firstMessage', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.create',
        headers: as.session,
        body: { firstMessage: { sendId: '', text: 'hi' } },
      })

      expect(reply.status).toBe(400)
      expect(launch).not.toHaveBeenCalled()
    })
  })

  describe('open', () => {
    const body = { runId: 'run_1', drafts: [] }

    it('maps the client-chosen id onto the service threadId', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.open',
        headers: as.session,
        body: { ...body, id: 'brn_fixed' },
      })

      expect(reply.status).toBe(200)
      expect(open).toHaveBeenCalledWith({
        userId: USER_ID,
        draft: { ...body, threadId: 'brn_fixed' },
      })
    })

    it('reaches a sandbox token that names a fresh id and its own family as spawner', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.open',
        headers: as.sandbox,
        body: { ...body, id: 'brn_new', agent: AGENT },
      })

      expect(reply.status).toBe(200)
      expect(open).toHaveBeenCalledTimes(1)
    })

    it('refuses a sandbox token with no agent, and a pod token', async () => {
      expect(
        (await mutate({ app, procedure: 'threads.open', headers: as.sandbox, body })).status,
      ).toBe(403)
      expect((await mutate({ app, procedure: 'threads.open', headers: as.pod, body })).status).toBe(
        403,
      )
      expect(open).not.toHaveBeenCalled()
    })

    it('rejects a body with no runId', async () => {
      const reply = await mutate({
        app,
        procedure: 'threads.open',
        headers: as.session,
        body: { drafts: [] },
      })

      expect(reply.status).toBe(400)
    })
  })
})
