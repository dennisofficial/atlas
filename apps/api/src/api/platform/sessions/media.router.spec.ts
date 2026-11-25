import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { vi } from 'bun:test'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { MediaRouter } from './media.router'
import { MediaService } from './media.service'

const media = { presign: vi.fn(), confirm: vi.fn(), url: vi.fn() }
const HASH = 'a'.repeat(64)

describe('MediaRouter', () => {
  let app: NestExpressApplication

  const post = (path: string, token: string | undefined, body: object) => {
    const sent = request(app.getHttpServer()).post(`/v1/trpc/media.${path}`)
    return (token === undefined ? sent : sent.set(as(token))).send(body)
  }
  const url = (token: string | undefined, input: object) =>
    request(app.getHttpServer())
      .get('/v1/trpc/media.url')
      .set(token === undefined ? {} : as(token))
      .query({ input: JSON.stringify(input) })

  beforeEach(async () => {
    for (const fn of Object.values(media)) fn.mockReset()
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        MediaRouter,
        SessionMiddleware,
        { provide: MediaService, useValue: media },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              if (req.headers.authorization !== 'Bearer session-a') return null
              return { userId: 'user-a', sessionId: 'ses', email: '' }
            },
          },
        },
      ],
    })
  })

  afterEach(() => app.close())

  it('rejects an unauthenticated caller on every procedure', async () => {
    expect(
      (
        await post('presign', undefined, {
          hash: HASH,
          size: 1,
          mediaType: 'image/png',
        })
      ).status,
    ).toBe(401)
    expect((await post('confirm', undefined, { hash: HASH })).status).toBe(401)
    expect((await url(undefined, { sessionId: 's', hash: HASH })).status).toBe(401)
    for (const fn of Object.values(media)) expect(fn).not.toHaveBeenCalled()
  })

  it('passes the signed-in user to each procedure', async () => {
    media.presign.mockResolvedValue({
      exists: false,
      uploadUrl: 'https://b.example/x',
      validUntil: 1,
    })
    media.confirm.mockResolvedValue({
      media: {
        hash: HASH,
        mediaType: 'image/png',
        size: 1,
        width: 1,
        height: 1,
      },
    })
    media.url.mockResolvedValue({ url: 'https://b.example/y' })

    const input = { hash: HASH, size: 1, mediaType: 'image/png' }
    expect((await post('presign', 'session-a', input)).status).toBe(200)
    expect(media.presign).toHaveBeenCalledWith({ userId: 'user-a', ...input })
    expect((await post('confirm', 'session-a', { hash: HASH })).status).toBe(200)
    expect(media.confirm).toHaveBeenCalledWith({
      userId: 'user-a',
      hash: HASH,
    })
    expect((await url('session-a', { sessionId: 's1', hash: HASH })).status).toBe(200)
    expect(media.url).toHaveBeenCalledWith({
      userId: 'user-a',
      sessionId: 's1',
      hash: HASH,
    })
  })

  it('rejects a presign for a type outside the supported images', async () => {
    const res = await post('presign', 'session-a', {
      hash: HASH,
      size: 1,
      mediaType: 'image/svg+xml',
    })
    expect(res.status).toBe(400)
    expect(media.presign).not.toHaveBeenCalled()
  })
})
