import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  assertThreadInFamily,
  CHILD_THREAD,
  createSessionsRouterApp,
  mutate,
  pod,
  query,
  sandbox,
  SANDBOX_THREAD,
  session,
  USER_ID,
  WIRE_THREAD,
} from './threads-routers.fixture'

const list = vi.fn(async () => [])
const mostRecent = vi.fn(async () => null)
const find = vi.fn(async () => WIRE_THREAD)
const spawned = vi.fn(async () => [])
const rename = vi.fn(async () => undefined)
const chooseModel = vi.fn(async () => undefined)
const adopt = vi.fn(async () => undefined)
const setArchived = vi.fn(async () => undefined)

const mutations = [
  { procedure: 'threads.rename', body: { title: 'new' }, invalid: { title: 3 } },
  { procedure: 'threads.archive', body: { archived: true }, invalid: { archived: 'yes' } },
  { procedure: 'threads.chooseModel', body: { ref: 'm', effort: 'high' }, invalid: { ref: '' } },
  { procedure: 'threads.adopt', body: { workspace: '/w', repo: null }, invalid: { workspace: '' } },
]

describe('ThreadsRouter queries and thread mutations', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createSessionsRouterApp({
      threads: { list, mostRecent, find, spawned, rename, chooseModel, adopt },
      archive: { setArchived },
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    for (const fake of [list, mostRecent, find, rename, setArchived, assertThreadInFamily]) {
      fake.mockClear()
    }
  })

  describe('recent', () => {
    it('answers null when the user has no thread for the project', async () => {
      const reply = await query({
        app,
        procedure: 'threads.recent',
        headers: session,
        input: { project: '/repo' },
      })

      expect(reply.status).toBe(200)
      expect(reply.body).toEqual({ result: { data: null } })
      expect(mostRecent).toHaveBeenCalledWith({ userId: USER_ID, project: '/repo' })
    })

    it('rejects an empty project', async () => {
      const reply = await query({
        app,
        procedure: 'threads.recent',
        headers: session,
        input: { project: '' },
      })

      expect(reply.status).toBe(400)
    })

    it('refuses a sandbox token, a pod token and an anonymous caller', async () => {
      const input = { project: '/repo' }

      expect(
        (await query({ app, procedure: 'threads.recent', headers: sandbox, input })).status,
      ).toBe(403)
      expect((await query({ app, procedure: 'threads.recent', headers: pod, input })).status).toBe(
        403,
      )
      expect((await query({ app, procedure: 'threads.recent', input })).status).toBe(401)
    })
  })

  describe('list', () => {
    it('lists by project', async () => {
      const reply = await query({
        app,
        procedure: 'threads.list',
        headers: session,
        input: { project: '/repo' },
      })

      expect(reply.status).toBe(200)
      expect(list).toHaveBeenCalledWith({ userId: USER_ID, project: '/repo' })
    })

    it('lists by projectId with a limit', async () => {
      await query({
        app,
        procedure: 'threads.list',
        headers: session,
        input: { projectId: 'prj_1', limit: 5 },
      })

      expect(list).toHaveBeenCalledWith({ userId: USER_ID, projectId: 'prj_1', limit: 5 })
    })

    it('refuses neither project nor projectId', async () => {
      for (const input of [{}, { project: '', projectId: '' }]) {
        const reply = await query({ app, procedure: 'threads.list', headers: session, input })
        expect(reply.status).toBe(400)
      }
      expect(list).not.toHaveBeenCalled()
    })

    it('refuses both project and projectId', async () => {
      const reply = await query({
        app,
        procedure: 'threads.list',
        headers: session,
        input: { project: '/repo', projectId: 'prj_1' },
      })

      expect(reply.status).toBe(400)
      expect(list).not.toHaveBeenCalled()
    })

    it('rejects a limit below one', async () => {
      const reply = await query({
        app,
        procedure: 'threads.list',
        headers: session,
        input: { project: '/repo', limit: 0 },
      })

      expect(reply.status).toBe(400)
    })

    it('refuses a sandbox token, which names no thread', async () => {
      const reply = await query({
        app,
        procedure: 'threads.list',
        headers: sandbox,
        input: { project: '/repo' },
      })

      expect(reply.status).toBe(403)
    })
  })

  describe.each(['threads.get', 'threads.spawned'])('%s', (procedure) => {
    it('serves a session', async () => {
      const reply = await query({ app, procedure, headers: session, input: { threadId: 'thr-9' } })

      expect(reply.status).toBe(200)
    })

    it('serves a sandbox token for its own thread and a child', async () => {
      for (const threadId of [SANDBOX_THREAD, CHILD_THREAD]) {
        const reply = await query({ app, procedure, headers: sandbox, input: { threadId } })
        expect(reply.status).toBe(200)
      }
    })

    it('refuses a sandbox token naming a thread outside its family', async () => {
      const reply = await query({
        app,
        procedure,
        headers: sandbox,
        input: { threadId: 'thr-other' },
      })

      expect(reply.status).toBe(401)
    })

    it('refuses a pod token and an anonymous caller', async () => {
      const input = { threadId: SANDBOX_THREAD }

      expect((await query({ app, procedure, headers: pod, input })).status).toBe(403)
      expect((await query({ app, procedure, input })).status).toBe(401)
    })

    it('rejects a missing threadId', async () => {
      expect((await query({ app, procedure, headers: session, input: {} })).status).toBe(400)
    })
  })

  describe.each(mutations)('$procedure', ({ procedure, body, invalid }) => {
    it('serves a session and forwards the owner and thread', async () => {
      const reply = await mutate({
        app,
        procedure,
        headers: session,
        body: { threadId: 'thr-1', ...body },
      })

      expect(reply.status).toBe(200)
    })

    it('serves a sandbox token for its own thread only', async () => {
      const own = await mutate({
        app,
        procedure,
        headers: sandbox,
        body: { threadId: SANDBOX_THREAD, ...body },
      })
      const other = await mutate({
        app,
        procedure,
        headers: sandbox,
        body: { threadId: 'thr-other', ...body },
      })

      expect(own.status).toBe(200)
      expect(other.status).toBe(401)
    })

    it('refuses a pod token and an anonymous caller', async () => {
      const full = { threadId: SANDBOX_THREAD, ...body }

      expect((await mutate({ app, procedure, headers: pod, body: full })).status).toBe(403)
      expect((await mutate({ app, procedure, body: full })).status).toBe(401)
    })

    it('rejects an invalid body', async () => {
      const reply = await mutate({
        app,
        procedure,
        headers: session,
        body: { threadId: 'thr-1', ...invalid },
      })

      expect(reply.status).toBe(400)
    })
  })

  it('forwards rename and archive arguments to their services', async () => {
    await mutate({
      app,
      procedure: 'threads.rename',
      headers: session,
      body: { threadId: 'thr-1', title: 'new' },
    })
    await mutate({
      app,
      procedure: 'threads.archive',
      headers: session,
      body: { threadId: 'thr-1', archived: true },
    })

    expect(rename).toHaveBeenCalledWith({
      userId: USER_ID,
      threadId: 'thr-1',
      draft: { threadId: 'thr-1', title: 'new' },
    })
    expect(setArchived).toHaveBeenCalledWith({ userId: USER_ID, threadId: 'thr-1', archived: true })
  })
})
