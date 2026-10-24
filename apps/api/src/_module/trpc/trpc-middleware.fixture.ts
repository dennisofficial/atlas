import { Global, Module, type Provider } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { ThrottlerModule } from '@nestjs/throttler'
import { TRPCModule } from 'nestjs-trpc'
import { EnvService } from '../../_core/config/env/env.service'
import { ApiTrpcContext } from './api-trpc-context'
import { ApiTrpcModule } from './api-trpc.module'
import { HttpErrorMiddleware } from './http-error.middleware'
import { apiErrorFormatter } from './trpc-error-formatter'
import { ThrottleMiddleware } from './throttle.middleware'

export const DEFAULT_RATE_LIMIT = 3

export const UNTHROTTLED_RATE_LIMIT = 100_000

export const fakeEnvModule = (rateLimit: number) => {
  @Global()
  @Module({
    providers: [{ provide: EnvService, useValue: { get: () => rateLimit } }],
    exports: [EnvService],
  })
  class FakeEnvModule {}
  return FakeEnvModule
}

export const as = (token: string): { authorization: string } => ({
  authorization: `Bearer ${token}`,
})

export async function createMiddlewareApp({
  providers,
  rateLimit = DEFAULT_RATE_LIMIT,
}: {
  providers: Provider[]
  rateLimit?: number
}): Promise<NestExpressApplication> {
  const module = await Test.createTestingModule({
    imports: [
      fakeEnvModule(rateLimit),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: rateLimit }]),
      ApiTrpcModule,
      TRPCModule.forRoot({
        basePath: '/v1/trpc',
        context: ApiTrpcContext,
        errorFormatter: apiErrorFormatter,
        globalMiddlewares: [HttpErrorMiddleware, ThrottleMiddleware],
      }),
    ],
    providers,
  }).compile()
  const app = module.createNestApplication<NestExpressApplication>()
  await app.init()
  return app
}
