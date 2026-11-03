import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { as } from '../../../_module/trpc/trpc-middleware.fixture'
import { createV2SessionsApp, sessions } from './v2-sessions.router.fixture'

describe('V2SessionsRouter', () => {
  let app: NestExpressApplication

  const create = (token: string | undefined, body: object) => {
    const sent = request(app.getHttpServer()).post('/v1/trpc/v2Sessions.create')
    return (token === undefined ? sent : sent.set(as(token))).send(body)
  }
  const list = (token: string | undefined, input: object = {}) =>
    request(app.getHttpServer())
      .get('/v1/trpc/v2Sessions.list')
      .set(token === undefined ? {} : as(token))
      .query({ input: JSON.stringify(input) })

  beforeEach(() => {
    for (const fn of Object.values(sessions)) fn.mockReset()
  })

  afterEach(() => app.close())

  describe('with user-a allowlisted', () => {
    beforeEach(async () => {
      app = await createV2SessionsApp({ allowlist: 'user-a' })
    })

    it('rejects an unauthenticated caller with 401', async () => {
      expect((await create(undefined, { projectId: 'proj-a' })).status).toBe(401)
      expect(sessions.create).not.toHaveBeenCalled()
    })

    it('refuses a non-listed user with 403', async () => {
      expect((await create('session-b', { projectId: 'proj-a' })).status).toBe(403)
      expect(sessions.create).not.toHaveBeenCalled()
    })

    it('creates a session for a listed user', async () => {
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

    it('lists for a listed user', async () => {
      sessions.list.mockResolvedValue({ sessions: [] })

      const response = await list('session-a', { limit: 5 })

      expect(response.status).toBe(200)
      expect(sessions.list).toHaveBeenCalledWith({ userId: 'user-a', limit: 5 })
    })

    it('refuses list for a non-listed user with 403', async () => {
      expect((await list('session-b')).status).toBe(403)
      expect(sessions.list).not.toHaveBeenCalled()
    })

    it('validates the input', async () => {
      expect((await create('session-a', {})).status).toBe(400)
      expect((await create('session-a', { projectId: '' })).status).toBe(400)
      expect((await create('session-a', { projectId: 'p', extra: 1 })).status).toBe(400)
      expect(sessions.create).not.toHaveBeenCalled()
    })
  })

  describe('with the allowlist unset', () => {
    beforeEach(async () => {
      app = await createV2SessionsApp()
    })

    it('refuses everyone', async () => {
      expect((await create('session-a', { projectId: 'proj-a' })).status).toBe(403)
      expect((await list('session-a')).status).toBe(403)
      expect(sessions.create).not.toHaveBeenCalled()
      expect(sessions.list).not.toHaveBeenCalled()
    })
  })

  describe('with an empty allowlist', () => {
    beforeEach(async () => {
      app = await createV2SessionsApp({ allowlist: '' })
    })

    it('refuses everyone', async () => {
      expect((await create('session-a', { projectId: 'proj-a' })).status).toBe(403)
      expect(sessions.create).not.toHaveBeenCalled()
    })
  })
})
