import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, vi } from 'bun:test'
import { createSessionsRouterApp, sandbox, WIRE_THREAD } from './threads-routers.fixture'

const create = vi.fn(async () => WIRE_THREAD)
const open = vi.fn(async () => ({ thread: WIRE_THREAD, events: [] }))

const _agentOf = (spawnedBy: string) => ({ spawnedBy, type: 'explore' })

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

  describe.each([{ kind: 'sandbox', headers: sandbox }])('under a $kind token', ({ headers }) => {
    describe.each([
      { procedure: 'threads.create', service: create, base: {} },
      { procedure: 'threads.open', service: open, base: { runId: 'run_1', drafts: [] } },
    ])('$procedure', ({ procedure, service, base }) => {})
  })
})
