import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  createSessionsRouterApp,
  mutate,
  pod,
  query,
  sandbox,
  SANDBOX_THREAD,
  session,
  USER_ID,
} from './threads-routers.fixture'

const record = vi.fn(async () => undefined)
const forThread = vi.fn(async () => [])
const forThreadTree = vi.fn(async () => ({ own: [], delegated: [] }))

const TURN = {
  status: 'done',
  providerId: 'anthropic',
  modelId: 'claude-opus',
  steps: 3,
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  startedAt: '2026-10-22T10:00:00.000Z',
  endedAt: '2026-10-22T10:01:00.000Z',
  durationMs: 60_000,
}

describe('ThreadTurnsRouter', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createSessionsRouterApp({ turns: { record, forThread, forThreadTree } })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    for (const fake of [record, forThread, forThreadTree]) fake.mockClear()
  })

  describe('record', () => {
    const body = { threadId: 'thr-1', runId: 'run_1', ...TURN }

    it('forwards the owner, thread, run and turn columns', async () => {
      const reply = await mutate({ app, procedure: 'threadTurns.record', headers: session, body })

      expect(reply.status).toBe(200)
      expect(record).toHaveBeenCalledWith({
        userId: USER_ID,
        threadId: 'thr-1',
        runId: 'run_1',
        draft: TURN,
      })
    })

    it('serves a sandbox token for its own thread and refuses another', async () => {
      const own = await mutate({
        app,
        procedure: 'threadTurns.record',
        headers: sandbox,
        body: { ...body, threadId: SANDBOX_THREAD },
      })
      const other = await mutate({
        app,
        procedure: 'threadTurns.record',
        headers: sandbox,
        body: { ...body, threadId: 'thr-other' },
      })

      expect(own.status).toBe(200)
      expect(other.status).toBe(401)
    })

    it('serves a pod token for its own thread and refuses an anonymous caller', async () => {
      expect(
        (await mutate({ app, procedure: 'threadTurns.record', headers: pod, body })).status,
      ).toBe(200)
      expect((await mutate({ app, procedure: 'threadTurns.record', body })).status).toBe(401)
    })

    it('rejects negative counters and a non-date timestamp', async () => {
      for (const bad of [{ steps: -1 }, { inputTokens: -1 }, { startedAt: 'yesterday' }]) {
        const reply = await mutate({
          app,
          procedure: 'threadTurns.record',
          headers: session,
          body: { ...body, ...bad },
        })
        expect(reply.status).toBe(400)
      }
      expect(record).not.toHaveBeenCalled()
    })

    it('rejects a body with no runId', async () => {
      const reply = await mutate({
        app,
        procedure: 'threadTurns.record',
        headers: session,
        body: { threadId: 'thr-1', ...TURN },
      })

      expect(reply.status).toBe(400)
    })
  })

  describe.each([
    { procedure: 'threadTurns.tree', empty: { own: [], delegated: [] } },
    { procedure: 'threadTurns.list', empty: [] },
  ])('$procedure', ({ procedure, empty }) => {
    it('answers for a session', async () => {
      const reply = await query({ app, procedure, headers: session, input: { threadId: 'thr-1' } })

      expect(reply.status).toBe(200)
      expect(reply.body).toEqual({ result: { data: empty } })
    })

    it('serves a sandbox token for its own thread and refuses another', async () => {
      const own = await query({
        app,
        procedure,
        headers: sandbox,
        input: { threadId: SANDBOX_THREAD },
      })
      const other = await query({
        app,
        procedure,
        headers: sandbox,
        input: { threadId: 'thr-other' },
      })

      expect(own.status).toBe(200)
      expect(other.status).toBe(401)
    })

    it('serves a pod token for its own thread and refuses an anonymous caller', async () => {
      const input = { threadId: SANDBOX_THREAD }

      expect((await query({ app, procedure, headers: pod, input })).status).toBe(200)
      expect((await query({ app, procedure, input })).status).toBe(401)
    })
  })
})
