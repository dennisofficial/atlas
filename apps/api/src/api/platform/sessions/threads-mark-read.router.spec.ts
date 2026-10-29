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
} from './threads-routers.fixture'

const markRead = vi.fn(async () => undefined)
const body = { threadId: SANDBOX_THREAD, seq: 4 }

describe('threads.markRead', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createSessionsRouterApp({ reads: { markRead } })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    markRead.mockClear()
  })

  it('marks the thread read for the owner session', async () => {
    const reply = await mutate({ app, procedure: 'threads.markRead', headers: session, body })

    expect(reply.status).toBe(200)
    expect(markRead).toHaveBeenCalledWith({ userId: USER_ID, threadId: SANDBOX_THREAD, seq: 4 })
  })

  it('refuses sandbox and pod tokens even for their own thread', async () => {
    for (const headers of [sandbox, pod]) {
      const reply = await mutate({ app, procedure: 'threads.markRead', headers, body })
      expect(reply.status).toBe(403)
    }
    expect(markRead).not.toHaveBeenCalled()
  })

  it('rejects a negative seq', async () => {
    const reply = await mutate({
      app,
      procedure: 'threads.markRead',
      headers: session,
      body: { ...body, seq: -1 },
    })

    expect(reply.status).toBe(400)
    expect(markRead).not.toHaveBeenCalled()
  })
})
