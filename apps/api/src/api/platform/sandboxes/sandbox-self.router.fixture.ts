import { UnauthorizedException } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { ThrottlerModule } from '@nestjs/throttler'
import { TRPCModule } from 'nestjs-trpc'
import { vi } from 'bun:test'
import { ApiTrpcContext } from '../../../_module/trpc/api-trpc-context'
import { ApiTrpcModule } from '../../../_module/trpc/api-trpc.module'
import { HttpErrorMiddleware } from '../../../_module/trpc/http-error.middleware'
import { ThrottleMiddleware } from '../../../_module/trpc/throttle.middleware'
import { apiErrorFormatter } from '../../../_module/trpc/trpc-error-formatter'
import {
  fakeEnvModule,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { JSON_BODY_LIMIT } from '../../../_lib/body-limits'
import { recordingSignals } from '../sessions/thread-signals.fixture'
import { ThreadSignalsService } from '../sessions/thread-signals.service'
import { SandboxSelfRouter } from './sandbox-self.router'
import { SandboxTokenMiddleware } from './sandbox-token.middleware'
import { SandboxesService } from './sandboxes.service'
import { ETokenPrincipalKind } from './token-principal'
import { VercelSandboxClient } from './vercel-sandbox.client'

export const routerSignals = recordingSignals()

export const SANDBOX_TOKEN = 'sandbox-token'
export const POD_TOKEN = 'pod-token'

export const vercel = {
  exposePort: vi.fn(
    async (_args: { threadId: string; name: string; port: number }) =>
      'https://atlas-5173.vercel.run',
  ),
  stopSession: vi.fn(
    async (_args: { threadId: string; name: string; sessionId?: string | undefined }) => undefined,
  ),
}

export const as = (token: string): { authorization: string } => ({
  authorization: `Bearer ${token}`,
})

export const procedurePath = (procedure: string): string => `/v1/trpc/sandboxSelf.${procedure}`

export async function createSandboxSelfApp(): Promise<NestExpressApplication> {
  const module = await Test.createTestingModule({
    imports: [
      fakeEnvModule(UNTHROTTLED_RATE_LIMIT),
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
      SandboxSelfRouter,
      { provide: ThreadSignalsService, useValue: routerSignals.signals },
      SandboxTokenMiddleware,
      { provide: VercelSandboxClient, useValue: vercel },
      {
        provide: SandboxesService,
        useValue: {
          async verifyTokenPrincipal(query: { token: string }) {
            if (query.token === SANDBOX_TOKEN) {
              return {
                kind: ETokenPrincipalKind.Sandbox,
                id: 'sbx-1',
                threadId: 'thr-1',
                userId: 'usr-1',
              }
            }
            if (query.token === POD_TOKEN) {
              return { kind: ETokenPrincipalKind.Pod, threadId: 'thr-1', userId: 'usr-1' }
            }
            throw new UnauthorizedException()
          },
        },
      },
    ],
  }).compile()
  const app = module.createNestApplication<NestExpressApplication>()
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT })
  await app.init()
  return app
}
