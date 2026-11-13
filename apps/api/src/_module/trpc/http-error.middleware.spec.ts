import type { INestApplication } from '@nestjs/common'
import { HttpException, HttpStatus, Logger } from '@nestjs/common'
import { Query, Router } from 'nestjs-trpc'
import request from 'supertest'
import type { Mock } from 'bun:test'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'bun:test'
import { z } from 'zod'
import { UNTHROTTLED_RATE_LIMIT, createMiddlewareApp } from './trpc-middleware.fixture'

const LEAKED_DSN = 'postgres://user:pw@host refused the connection'

@Router({ alias: 'faults' })
class FaultRouter {
  @Query({ output: z.string() })
  serverFault(): string {
    throw new HttpException(LEAKED_DSN, HttpStatus.INTERNAL_SERVER_ERROR, {
      cause: new Error('pod boot failed', { cause: new Error('BlobAccessError: Access denied') }),
    })
  }

  @Query({ output: z.string() })
  clientFault(): string {
    throw new HttpException('input is invalid', HttpStatus.BAD_REQUEST)
  }
}

describe('HttpErrorMiddleware', () => {
  let app: INestApplication
  let errorLog: Mock<Logger['error']>

  const call = (procedure: string) =>
    request(app.getHttpServer()).get(`/v1/trpc/faults.${procedure}`)

  beforeAll(async () => {
    errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    app = await createMiddlewareApp({
      providers: [FaultRouter],
      rateLimit: UNTHROTTLED_RATE_LIMIT,
    })
  })

  afterEach(() => vi.clearAllMocks())

  afterAll(async () => {
    await app.close()
    vi.restoreAllMocks()
  })

  it('answers a server fault with a generic body that carries no stack and no cause', async () => {
    const reply = await call('serverFault').expect(500)

    expect(reply.body.error.data).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      httpStatus: 500,
    })
    expect(reply.body.error.message).toBe('Internal server error')
    expect(reply.body.error.data.stack).toBeUndefined()
    expect(reply.body.error.data.cause).toBeUndefined()
    expect(reply.body.error.cause).toBeUndefined()
    expect(reply.text).not.toContain(LEAKED_DSN)
    expect(reply.text).not.toContain('BlobAccessError')
    expect(reply.text).not.toContain('at ')
  })

  it('logs the original error with everything the cause chain holds', async () => {
    await call('serverFault').expect(500)

    const written = errorLog.mock.calls.map(([entry]) => String(entry)).join('\n')
    expect(written).toContain(LEAKED_DSN)
    expect(written).toContain('BlobAccessError: Access denied')
  })

  it('keeps a client-facing 4xx message and still ships no stack', async () => {
    const reply = await call('clientFault').expect(400)

    expect(reply.body.error.message).toBe('input is invalid')
    expect(reply.body.error.data.stack).toBeUndefined()
    expect(reply.text).not.toContain('at ')
  })
})
