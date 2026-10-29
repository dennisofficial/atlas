import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  CHILD_THREAD,
  createSessionsRouterApp,
  mutate,
  pod,
  SANDBOX_THREAD,
  sandbox,
  WIRE_THREAD,
} from './threads-routers.fixture'

const create = vi.fn(async () => WIRE_THREAD)
const open = vi.fn(async () => ({ thread: WIRE_THREAD, events: [] }))

const agentOf = (spawnedBy: string) => ({ spawnedBy, type: 'explore' })

describe('token spawn depth', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createSessionsRouterApp({ threads: { create, open } })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    create.mockClear()
    open.mockClear()
  })

  describe.each([
    { kind: 'sandbox', headers: sandbox },
    { kind: 'pod', headers: pod },
  ])('under a $kind token', ({ headers }) => {
    describe.each([
      { procedure: 'threads.create', service: create, base: {} },
      { procedure: 'threads.open', service: open, base: { runId: 'run_1', drafts: [] } },
    ])('$procedure', ({ procedure, service, base }) => {
      it('spawns a direct child of the token thread', async () => {
        const body = { ...base, agent: agentOf(SANDBOX_THREAD) }
        const reply = await mutate({ app, procedure, headers, body })

        expect(reply.status).toBe(200)
        expect(service).toHaveBeenCalledTimes(1)
      })

      it('refuses a grandchild spawned by its own sub-agent', async () => {
        const body = { ...base, agent: agentOf(CHILD_THREAD) }
        const reply = await mutate({ app, procedure, headers, body })

        expect(reply.status).toBe(403)
        expect(service).not.toHaveBeenCalled()
      })

      it('refuses a spawner outside its family', async () => {
        const body = { ...base, agent: agentOf('thr-other') }
        const reply = await mutate({ app, procedure, headers, body })

        expect(reply.status).toBe(403)
        expect(service).not.toHaveBeenCalled()
      })
    })
  })
})
