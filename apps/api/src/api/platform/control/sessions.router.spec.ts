import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { as } from '../../../_module/trpc/trpc-middleware.fixture'
import { createSessionsApp, sessions } from './sessions.router.fixture'

describe('SessionsRouter', () => {
  let app: NestExpressApplication

  const create = (token: string | undefined, body: object) => {
    const sent = request(app.getHttpServer()).post('/v1/trpc/sessions.create')
    return (token === undefined ? sent : sent.set(as(token))).send(body)
  }
  const list = (token: string | undefined, input: object = {}) =>
    request(app.getHttpServer())
      .get('/v1/trpc/sessions.list')
      .set(token === undefined ? {} : as(token))
      .query({ input: JSON.stringify(input) })

  beforeEach(async () => {
    for (const fn of Object.values(sessions)) fn.mockReset()
    app = await createSessionsApp()
  })

  afterEach(() => app.close())

  it('rejects an unauthenticated caller with 401', async () => {
    expect((await create(undefined, { projectId: 'proj-a' })).status).toBe(401)
    expect((await list(undefined)).status).toBe(401)
    expect(sessions.create).not.toHaveBeenCalled()
    expect(sessions.list).not.toHaveBeenCalled()
  })

  it('creates a session for a signed-in user', async () => {
    sessions.create.mockResolvedValue({ sessionId: 's1', mainThreadId: 't1' })

    const response = await create('session-a', { projectId: 'proj-a', title: 'hi' })

    expect(response.status).toBe(200)
    expect(response.body.result.data).toEqual({ sessionId: 's1', mainThreadId: 't1' })
    expect(sessions.create).toHaveBeenCalledWith({
      userId: 'user-a',
      projectId: 'proj-a',
      title: 'hi',
    })
  })

  it('lists for a signed-in user', async () => {
    sessions.list.mockResolvedValue({ sessions: [] })

    const response = await list('session-a', { limit: 5 })

    expect(response.status).toBe(200)
    expect(sessions.list).toHaveBeenCalledWith({ userId: 'user-a', limit: 5 })
  })

  it('opens create and list to any signed-in user', async () => {
    sessions.create.mockResolvedValue({ sessionId: 's2', mainThreadId: 't2' })
    sessions.list.mockResolvedValue({ sessions: [] })

    expect((await create('session-b', { projectId: 'proj-b' })).status).toBe(200)
    expect((await list('session-b')).status).toBe(200)
    expect(sessions.create).toHaveBeenCalledWith({ userId: 'user-b', projectId: 'proj-b' })
    expect(sessions.list).toHaveBeenCalledWith({ userId: 'user-b' })
  })

  it('validates the input', async () => {
    expect((await create('session-a', {})).status).toBe(400)
    expect((await create('session-a', { projectId: '' })).status).toBe(400)
    expect((await create('session-a', { projectId: 'p', extra: 1 })).status).toBe(400)
    expect(sessions.create).not.toHaveBeenCalled()
  })

  it('reads a blob range for a signed-in user and rejects bad ranges', async () => {
    sessions.blob.mockResolvedValue({ size: 10, offset: 0, bytes: 'aGk=' })

    const read = (input: object) =>
      request(app.getHttpServer())
        .get('/v1/trpc/sessions.blob')
        .set(as('session-a'))
        .query({ input: JSON.stringify(input) })

    const ok = await read({ sessionId: 's1', hash: 'abc' })
    expect(ok.status).toBe(200)
    expect(ok.body.result.data).toEqual({ size: 10, offset: 0, bytes: 'aGk=' })
    expect(sessions.blob).toHaveBeenCalledWith({ userId: 'user-a', sessionId: 's1', hash: 'abc' })

    expect((await read({ sessionId: 's1', hash: 'abc', offset: -1 })).status).toBe(400)
    expect((await read({ sessionId: 's1', hash: 'abc', length: 2_000_001 })).status).toBe(400)
  })

  it('refuses batched calls to events and blob', async () => {
    const input = JSON.stringify({
      0: { sessionId: 's1' },
      1: { sessionId: 's1', hash: 'abc' },
    })
    const batched = await request(app.getHttpServer())
      .get('/v1/trpc/sessions.events,sessions.blob')
      .set(as('session-a'))
      .query({ batch: '1', input })
    expect(batched.status).toBe(400)
    expect(sessions.events).not.toHaveBeenCalled()
    expect(sessions.blob).not.toHaveBeenCalled()

    sessions.list.mockResolvedValue({ sessions: [] })
    const allowed = await request(app.getHttpServer())
      .get('/v1/trpc/sessions.list,sessions.list')
      .set(as('session-a'))
      .query({ batch: '1', input: JSON.stringify({ 0: {}, 1: {} }) })
    expect(allowed.status).toBe(200)
  })
})
