import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'

import { createSessionsRouterApp, query, session, USER_ID } from './threads-routers.fixture'

const read = mock(async () => [])
const readOwn = mock(async () => [])

describe('ThreadEventsRouter fromSeq', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createSessionsRouterApp({ events: { read, readOwn } })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    read.mockClear()
    readOwn.mockClear()
  })

  it.each([false, true])('forwards inclusive fromSeq with own=%s', async (own) => {
    const reply = await query({
      app,
      procedure: 'threadEvents.read',
      headers: session,
      input: { threadId: 'thr-1', fromSeq: 4, upTo: 8, own },
    })

    expect(reply.status).toBe(200)
    expect(own ? readOwn : read).toHaveBeenCalledWith({
      userId: USER_ID,
      threadId: 'thr-1',
      fromSeq: 4,
      upTo: 8,
    })
  })

  it.each([-1, 1.5])('rejects invalid fromSeq %s', async (fromSeq) => {
    const reply = await query({
      app,
      procedure: 'threadEvents.read',
      headers: session,
      input: { threadId: 'thr-1', fromSeq },
    })

    expect(reply.status).toBe(400)
    expect(read).not.toHaveBeenCalled()
    expect(readOwn).not.toHaveBeenCalled()
  })
})
