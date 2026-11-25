import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  createSessionsRouterApp,
  mutate,
  SANDBOX_THREAD,
  sandbox,
  session,
  USER_ID,
  WIRE_THREAD,
} from './threads-routers.fixture'

const AGENT = { spawnedBy: SANDBOX_THREAD, type: 'explore' }
const _BODY = { runId: 'run_1', drafts: [], id: 'brn_child', agent: AGENT }

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

  describe.each([{ kind: 'sandbox', headers: sandbox }])('under a $kind token', ({ headers }) => {})

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
