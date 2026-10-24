import type { INestApplication } from '@nestjs/common'
import { Query, Router } from 'nestjs-trpc'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { meta } from './procedure-meta'
import { DEFAULT_RATE_LIMIT, createMiddlewareApp } from './trpc-middleware.fixture'

@Router({ alias: 'rate' })
class RateRouter {
  @Query({ output: z.string() })
  plain(): string {
    return 'ok'
  }

  @Query({ output: z.string() })
  other(): string {
    return 'ok'
  }

  @Query({ output: z.string(), meta: meta({ throttle: { limit: 2, ttlMs: 60_000 } }) })
  tight(): string {
    return 'ok'
  }

  @Query({ output: z.string(), meta: meta({ throttle: false }) })
  unlimited(): string {
    return 'ok'
  }
}

describe('ThrottleMiddleware', () => {
  let app: INestApplication
  const call = (procedure: string) => request(app.getHttpServer()).get(`/v1/trpc/rate.${procedure}`)
  const statuses = async (procedure: string, times: number): Promise<number[]> => {
    const out: number[] = []
    for (let index = 0; index < times; index += 1) out.push((await call(procedure)).status)
    return out
  }

  beforeAll(async () => {
    app = await createMiddlewareApp({ providers: [RateRouter] })
  })

  afterAll(async () => {
    await app.close()
  })

  it('answers 429 on the call after the env default limit', async () => {
    const results = await statuses('plain', DEFAULT_RATE_LIMIT + 1)

    expect(results).toEqual([200, 200, 200, 429])
  })

  it('counts each procedure separately', async () => {
    expect(await statuses('other', 1)).toEqual([200])
  })

  it('honours a per-procedure limit', async () => {
    expect(await statuses('tight', 3)).toEqual([200, 200, 429])
  })

  it('tells the client the code is TOO_MANY_REQUESTS', async () => {
    const reply = await call('tight')

    expect(reply.body.error.data).toMatchObject({ code: 'TOO_MANY_REQUESTS', httpStatus: 429 })
  })

  it('never limits a procedure with throttle: false', async () => {
    const results = await statuses('unlimited', DEFAULT_RATE_LIMIT * 3)

    expect(new Set(results)).toEqual(new Set([200]))
  })
})
