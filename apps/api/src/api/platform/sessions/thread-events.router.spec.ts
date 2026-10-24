import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  CHILD_THREAD,
  createSessionsRouterApp,
  mutate,
  pod,
  query,
  sandbox,
  SANDBOX_THREAD,
  session,
  USER_ID,
} from './threads-routers.fixture'

const append = vi.fn(async () => [])
const replace = vi.fn(async () => [])
const read = vi.fn(async () => [])
const readOwn = vi.fn(async () => [])
const importEvents = vi.fn(async () => ({ head: 4 }))
const head = vi.fn(async () => ({ head: 7 }))

const DRAFT = { type: 'user-said', body: '{}' }
const POD_EVENT = {
  seq: 4,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'assistant-said',
  body: '{}',
}

describe('ThreadEventsRouter', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createSessionsRouterApp({
      events: { append, replace, read, readOwn, importEvents, head },
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    for (const fake of [append, replace, read, readOwn, importEvents, head]) fake.mockClear()
  })

  describe('append and replace', () => {
    const cases = [
      { procedure: 'threadEvents.append', service: append, empty: { drafts: [] } },
      { procedure: 'threadEvents.replace', service: replace, empty: { drafts: 'x' } },
    ]

    describe.each(cases)('$procedure', ({ procedure, service, empty }) => {
      const body = { threadId: 'thr-1', runId: 'run_1', drafts: [DRAFT] }

      it('forwards the owner and thread for a session', async () => {
        const reply = await mutate({ app, procedure, headers: session, body })

        expect(reply.status).toBe(200)
        expect(service).toHaveBeenCalledWith({ userId: USER_ID, threadId: 'thr-1', draft: body })
      })

      it('serves a sandbox token for its own family only', async () => {
        const own = await mutate({
          app,
          procedure,
          headers: sandbox,
          body: { ...body, threadId: CHILD_THREAD },
        })
        const other = await mutate({
          app,
          procedure,
          headers: sandbox,
          body: { ...body, threadId: 'thr-other' },
        })

        expect(own.status).toBe(200)
        expect(other.status).toBe(401)
      })

      it('refuses a pod token and an anonymous caller', async () => {
        expect((await mutate({ app, procedure, headers: pod, body })).status).toBe(403)
        expect((await mutate({ app, procedure, body })).status).toBe(401)
      })

      it('rejects an invalid body', async () => {
        const reply = await mutate({
          app,
          procedure,
          headers: session,
          body: { ...body, ...empty },
        })

        expect(reply.status).toBe(400)
      })

      it('rejects a body with no runId', async () => {
        const reply = await mutate({
          app,
          procedure,
          headers: session,
          body: { threadId: 'thr-1', drafts: [DRAFT] },
        })

        expect(reply.status).toBe(400)
      })
    })
  })

  describe('read', () => {
    it('reads the composed log up to a seq', async () => {
      const reply = await query({
        app,
        procedure: 'threadEvents.read',
        headers: session,
        input: { threadId: 'thr-1', upTo: 3 },
      })

      expect(reply.status).toBe(200)
      expect(read).toHaveBeenCalledWith({ userId: USER_ID, threadId: 'thr-1', upTo: 3 })
      expect(readOwn).not.toHaveBeenCalled()
    })

    it('reads only the thread own rows when own is true', async () => {
      await query({
        app,
        procedure: 'threadEvents.read',
        headers: session,
        input: { threadId: 'thr-1', own: true },
      })

      expect(readOwn).toHaveBeenCalledWith({ userId: USER_ID, threadId: 'thr-1', upTo: undefined })
      expect(read).not.toHaveBeenCalled()
    })

    it('reads the composed log when own is false', async () => {
      await query({
        app,
        procedure: 'threadEvents.read',
        headers: session,
        input: { threadId: 'thr-1', own: false },
      })

      expect(read).toHaveBeenCalledTimes(1)
    })

    it('serves a sandbox token for its own thread and refuses another', async () => {
      const own = await query({
        app,
        procedure: 'threadEvents.read',
        headers: sandbox,
        input: { threadId: SANDBOX_THREAD },
      })
      const other = await query({
        app,
        procedure: 'threadEvents.read',
        headers: sandbox,
        input: { threadId: 'thr-other' },
      })

      expect(own.status).toBe(200)
      expect(other.status).toBe(401)
    })

    it('refuses a pod token and an anonymous caller', async () => {
      const input = { threadId: SANDBOX_THREAD }

      expect(
        (await query({ app, procedure: 'threadEvents.read', headers: pod, input })).status,
      ).toBe(403)
      expect((await query({ app, procedure: 'threadEvents.read', input })).status).toBe(401)
    })

    it('rejects a negative upTo', async () => {
      const reply = await query({
        app,
        procedure: 'threadEvents.read',
        headers: session,
        input: { threadId: 'thr-1', upTo: -1 },
      })

      expect(reply.status).toBe(400)
    })
  })

  describe('import', () => {
    const body = { threadId: 'thr-1', events: [POD_EVENT] }

    it('imports for the owner session', async () => {
      const reply = await mutate({ app, procedure: 'threadEvents.import', headers: session, body })

      expect(reply.status).toBe(200)
      expect(reply.body).toEqual({ result: { data: { head: 4 } } })
      expect(importEvents).toHaveBeenCalledWith({
        userId: USER_ID,
        threadId: 'thr-1',
        events: [POD_EVENT],
      })
    })

    it('refuses a sandbox principal even for its own thread', async () => {
      const reply = await mutate({
        app,
        procedure: 'threadEvents.import',
        headers: sandbox,
        body: { ...body, threadId: SANDBOX_THREAD },
      })

      expect(reply.status).toBe(403)
      expect(importEvents).not.toHaveBeenCalled()
    })

    it('refuses a pod principal and an anonymous caller', async () => {
      expect(
        (await mutate({ app, procedure: 'threadEvents.import', headers: pod, body })).status,
      ).toBe(403)
      expect((await mutate({ app, procedure: 'threadEvents.import', body })).status).toBe(401)
      expect(importEvents).not.toHaveBeenCalled()
    })

    it('rejects an empty or malformed event batch', async () => {
      for (const events of [[], [{ seq: 'x' }]]) {
        const reply = await mutate({
          app,
          procedure: 'threadEvents.import',
          headers: session,
          body: { threadId: 'thr-1', events },
        })
        expect(reply.status).toBe(400)
      }
      expect(importEvents).not.toHaveBeenCalled()
    })
  })

  describe('head', () => {
    it('answers the head for a session', async () => {
      const reply = await query({
        app,
        procedure: 'threadEvents.head',
        headers: session,
        input: { threadId: 'thr-1' },
      })

      expect(reply.body).toEqual({ result: { data: { head: 7 } } })
      expect(head).toHaveBeenCalledWith({ userId: USER_ID, threadId: 'thr-1' })
    })

    it('serves a sandbox token for its own thread and refuses another', async () => {
      const own = await query({
        app,
        procedure: 'threadEvents.head',
        headers: sandbox,
        input: { threadId: SANDBOX_THREAD },
      })
      const other = await query({
        app,
        procedure: 'threadEvents.head',
        headers: sandbox,
        input: { threadId: 'thr-other' },
      })

      expect(own.status).toBe(200)
      expect(other.status).toBe(401)
    })

    it('refuses a pod token and an anonymous caller', async () => {
      const input = { threadId: SANDBOX_THREAD }

      expect(
        (await query({ app, procedure: 'threadEvents.head', headers: pod, input })).status,
      ).toBe(403)
      expect((await query({ app, procedure: 'threadEvents.head', input })).status).toBe(401)
    })
  })
})
