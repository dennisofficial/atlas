import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  createSessionsRouterApp,
  mutate,
  pod,
  SANDBOX_THREAD,
  sandbox,
  session,
  USER_ID,
  WIRE_THREAD,
} from './threads-routers.fixture'

const AGENT = { spawnedBy: SANDBOX_THREAD, type: 'explore' }
const BODY = { runId: 'run_1', drafts: [], id: 'brn_child', agent: AGENT }

const open = vi.fn(async () => ({ thread: WIRE_THREAD, events: [] }))

describe('threads.open scope', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createSessionsRouterApp({ threads: { open } })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    open.mockClear()
  })

  describe.each([
    { kind: 'sandbox', headers: sandbox },
    { kind: 'pod', headers: pod },
  ])('under a $kind token', ({ headers }) => {
    it('confines the open to the token thread family', async () => {
      const reply = await mutate({ app, procedure: 'threads.open', headers, body: BODY })

      expect(reply.status).toBe(200)
      const { id, ...rest } = BODY
      expect(open).toHaveBeenCalledWith({
        userId: USER_ID,
        confinedTo: SANDBOX_THREAD,
        draft: { ...rest, threadId: id },
      })
    })

    it('refuses an executionLocation', async () => {
      const body = { ...BODY, executionLocation: 'cloud' }
      const reply = await mutate({ app, procedure: 'threads.open', headers, body })

      expect(reply.status).toBe(403)
      expect(open).not.toHaveBeenCalled()
    })
  })

  it('leaves a session open unconfined and free to set an executionLocation', async () => {
    const body = { runId: 'run_1', drafts: [], id: 'brn_any', executionLocation: 'cloud' }
    const reply = await mutate({ app, procedure: 'threads.open', headers: session, body })

    expect(reply.status).toBe(200)
    expect(open).toHaveBeenCalledWith({
      userId: USER_ID,
      draft: { runId: 'run_1', drafts: [], executionLocation: 'cloud', threadId: 'brn_any' },
    })
  })
})
