import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, vi } from 'bun:test'
import { createSessionsRouterApp, SANDBOX_THREAD, WIRE_THREAD } from './threads-routers.fixture'

const _FIRST = { sendId: 'snd-1', text: 'hi' }
const _AGENT = { spawnedBy: SANDBOX_THREAD, type: 'explore' }

const create = vi.fn(async () => WIRE_THREAD)
const open = vi.fn(async () => ({ thread: WIRE_THREAD, events: [] }))
const chooseModel = vi.fn(async () => undefined)
const launch = vi.fn(async () => ({ thread: WIRE_THREAD, provision: { state: 'booting' } }))

describe('ThreadsRouter under a pod token', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createSessionsRouterApp({
      threads: { create, open, chooseModel },
      launcher: { launch },
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    for (const fake of [create, open, chooseModel, launch]) {
      fake.mockClear()
    }
  })
})
