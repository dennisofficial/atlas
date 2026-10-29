import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  createSessionsRouterApp,
  mutate,
  pod,
  SANDBOX_THREAD,
  WIRE_THREAD,
} from './threads-routers.fixture'

const FIRST = { sendId: 'snd-1', text: 'hi' }
const AGENT = { spawnedBy: SANDBOX_THREAD, type: 'explore' }

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

  it('refuses a pod token on threads.create, with or without an agent', async () => {
    for (const body of [{ title: 'x' }, { agent: AGENT }, { firstMessage: FIRST, agent: AGENT }]) {
      const reply = await mutate({ app, procedure: 'threads.create', headers: pod, body })
      expect(reply.status).toBe(403)
    }
    expect((await mutate({ app, procedure: 'threads.create', body: { title: 'x' } })).status).toBe(
      401,
    )
    expect(create).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })

  it('refuses a pod token on threads.open', async () => {
    const reply = await mutate({
      app,
      procedure: 'threads.open',
      headers: pod,
      body: { runId: 'run_1', drafts: [], id: 'brn_new', agent: AGENT },
    })

    expect(reply.status).toBe(403)
    expect(open).not.toHaveBeenCalled()
  })

  it('refuses a pod token on threads.chooseModel for its own thread', async () => {
    const body = { threadId: SANDBOX_THREAD, ref: 'anthropic/claude', effort: 'high' }
    const reply = await mutate({ app, procedure: 'threads.chooseModel', headers: pod, body })

    expect(reply.status).toBe(403)
    expect(chooseModel).not.toHaveBeenCalled()
  })
})
