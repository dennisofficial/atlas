import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { as } from '../../../_module/trpc/trpc-middleware.fixture'
import { createContextMirrorApp, mirror } from './context-mirror.router.fixture'

describe('ContextMirrorRouter', () => {
  let app: NestExpressApplication

  const get = (args: { token?: string; procedure: string; input: object }) =>
    request(app.getHttpServer())
      .get(`/v1/trpc/contextMirror.${args.procedure}`)
      .set(args.token === undefined ? {} : as(args.token))
      .query({ input: JSON.stringify(args.input) })

  beforeEach(async () => {
    for (const fn of Object.values(mirror)) fn.mockReset()
    app = await createContextMirrorApp()
  })

  afterEach(() => app.close())

  it('rejects an unauthenticated caller with 401', async () => {
    const response = await get({ procedure: 'list', input: { sessionId: 's1' } })

    expect(response.status).toBe(401)
    expect(mirror.list).not.toHaveBeenCalled()
  })

  it('lists for the signed-in user', async () => {
    mirror.list.mockResolvedValue({ files: [] })

    const response = await get({
      token: 'session-a',
      procedure: 'list',
      input: { sessionId: 's1' },
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.text)).toEqual({ result: { data: { files: [] } } })
    expect(mirror.list).toHaveBeenCalledWith({ userId: 'user-a', sessionId: 's1' })
  })

  it('reads for the signed-in user', async () => {
    mirror.read.mockResolvedValue({
      file: { type: 'refused', path: 'a.md', reason: 'too large to mirror (20.0 MB)' },
    })

    const response = await get({
      token: 'session-a',
      procedure: 'read',
      input: { sessionId: 's1', path: 'a.md' },
    })

    expect(response.status).toBe(200)
    expect(mirror.read).toHaveBeenCalledWith({ userId: 'user-a', sessionId: 's1', path: 'a.md' })
  })
})
