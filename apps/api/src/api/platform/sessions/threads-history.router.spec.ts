import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  createSessionsRouterApp,
  mutate,
  pod,
  sandbox,
  SANDBOX_THREAD,
  session,
  USER_ID,
  WIRE_THREAD,
} from './threads-routers.fixture'

const rewind = vi.fn(async () => undefined)
const compact = vi.fn(async () => ({ replaced: 2 }))
const summarise = vi.fn(async () => ({ replaced: 3 }))
const fork = vi.fn(async () => WIRE_THREAD)

const RANGE = { anchor: 'prefix', fromSeq: 1, throughSeq: 4, summary: 's' }

const mutations = [
  { procedure: 'threads.rewind', body: { toSeq: 2 }, invalid: { toSeq: -1 } },
  { procedure: 'threads.compact', body: RANGE, invalid: { ...RANGE, anchor: 'middle' } },
  { procedure: 'threads.summarise', body: RANGE, invalid: { ...RANGE, fromSeq: -2 } },
  { procedure: 'threads.fork', body: { seq: 1, mode: 'copy' }, invalid: { seq: 1, mode: 'move' } },
]

describe('ThreadsRouter history mutations', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createSessionsRouterApp({ history: { rewind, compact, summarise, fork } })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    rewind.mockClear()
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

    it('serves a pod token for its own thread and refuses an anonymous caller', async () => {
      const full = { threadId: SANDBOX_THREAD, ...body }

      expect((await mutate({ app, procedure, headers: pod, body: full })).status).toBe(200)
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

  it('forwards rewind arguments to the history service', async () => {
    await mutate({
      app,
      procedure: 'threads.rewind',
      headers: session,
      body: { threadId: 'thr-1', toSeq: 2, cutAgents: ['a'] },
    })

    expect(rewind).toHaveBeenCalledWith({
      userId: USER_ID,
      threadId: 'thr-1',
      draft: { threadId: 'thr-1', toSeq: 2, cutAgents: ['a'] },
    })
  })

  it('returns the replaced count for compact and summarise', async () => {
    const compacted = await mutate({
      app,
      procedure: 'threads.compact',
      headers: session,
      body: { threadId: 'thr-1', ...RANGE },
    })
    const summarised = await mutate({
      app,
      procedure: 'threads.summarise',
      headers: session,
      body: { threadId: 'thr-1', ...RANGE },
    })

    expect(compacted.body).toEqual({ result: { data: { replaced: 2 } } })
    expect(summarised.body).toEqual({ result: { data: { replaced: 3 } } })
  })
})
