import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { ThrottlerModule } from '@nestjs/throttler'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { TRPCModule } from 'nestjs-trpc'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import { JSON_BODY_LIMIT } from '../../../_lib/body-limits'
import { ApiTrpcContext } from '../../../_module/trpc/api-trpc-context'
import { ApiTrpcModule } from '../../../_module/trpc/api-trpc.module'
import { HttpErrorMiddleware } from '../../../_module/trpc/http-error.middleware'
import { ThrottleMiddleware } from '../../../_module/trpc/throttle.middleware'
import { apiErrorFormatter } from '../../../_module/trpc/trpc-error-formatter'
import {
  fakeEnvModule,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { PreviewTunnelService } from '../sandboxes/preview-tunnel.service'
import { HostSelfRouter } from './host-self.router'
import { HostTokenMiddleware } from './host-token.middleware'

const HOST_TOKEN = 'host-token'
const PROCEDURE = '/v1/trpc/hostSelf.exposePort'

const previews = {
  expose: vi.fn(async (args: { threadId: string; userId: string; port: number }) => ({
    url: `https://${args.port}-abc.byatlas.dev`,
    tunnelToken: 'tunnel-token',
  })),
}

const createHostSelfApp = async (): Promise<NestExpressApplication> => {
  const module = await Test.createTestingModule({
    imports: [
      fakeEnvModule(UNTHROTTLED_RATE_LIMIT, { AGENT_HOST_TOKEN: HOST_TOKEN }),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: UNTHROTTLED_RATE_LIMIT }]),
      ApiTrpcModule,
      TRPCModule.forRoot({
        basePath: '/v1/trpc',
        context: ApiTrpcContext,
        errorFormatter: apiErrorFormatter,
        globalMiddlewares: [HttpErrorMiddleware, ThrottleMiddleware],
      }),
    ],
    providers: [
      HostSelfRouter,
      HostTokenMiddleware,
      { provide: PreviewTunnelService, useValue: previews },
    ],
  }).compile()
  const app = module.createNestApplication<NestExpressApplication>()
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT })
  await app.init()
  return app
}

const post = (args: {
  app: NestExpressApplication
  token: string | undefined
  body: unknown
}): request.Test => {
  const call = request(args.app.getHttpServer()).post(PROCEDURE)
  return (
    args.token === undefined ? call : call.set({ authorization: `Bearer ${args.token}` })
  ).send(args.body as object)
}

describe('HostSelfRouter', () => {
  useTestDatabase()
  let app: NestExpressApplication

  beforeAll(async () => {
    app = await createHostSelfApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    previews.expose.mockClear()
    await seedUsers('usr-1')
    await seedThreadRow({ id: 'thr_host', userId: 'usr-1' })
  })

  it('exposes a port for the thread the host names', async () => {
    const response = await post({
      app,
      token: HOST_TOKEN,
      body: { threadId: 'thr_host', port: 4317 },
    })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      result: { data: { url: 'https://4317-abc.byatlas.dev', tunnelToken: 'tunnel-token' } },
    })
    expect(previews.expose).toHaveBeenCalledWith({
      threadId: 'thr_host',
      userId: 'usr-1',
      port: 4317,
    })
  })

  it('refuses a call without a token', async () => {
    const response = await post({
      app,
      token: undefined,
      body: { threadId: 'thr_host', port: 4317 },
    })
    expect(response.status).toBe(401)
    expect(previews.expose).not.toHaveBeenCalled()
  })

  it('refuses a call with the wrong token', async () => {
    const response = await post({
      app,
      token: 'not-it',
      body: { threadId: 'thr_host', port: 4317 },
    })
    expect(response.status).toBe(401)
    expect(previews.expose).not.toHaveBeenCalled()
  })

  it('rejects a port below the range', async () => {
    const response = await post({ app, token: HOST_TOKEN, body: { threadId: 'thr_host', port: 0 } })
    expect(response.status).toBe(400)
    expect(previews.expose).not.toHaveBeenCalled()
  })

  it('rejects a port above the range', async () => {
    const response = await post({
      app,
      token: HOST_TOKEN,
      body: { threadId: 'thr_host', port: 65_536 },
    })
    expect(response.status).toBe(400)
    expect(previews.expose).not.toHaveBeenCalled()
  })

  it('answers not found for a thread that does not exist', async () => {
    const response = await post({
      app,
      token: HOST_TOKEN,
      body: { threadId: 'thr_nope', port: 4317 },
    })
    expect(response.status).toBe(404)
    expect(previews.expose).not.toHaveBeenCalled()
  })
})
