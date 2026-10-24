import type { INestApplication, Provider, Type } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { ThrottlerModule } from '@nestjs/throttler'
import { TRPCModule } from 'nestjs-trpc'
import { ApiTrpcContext } from '../../../_module/trpc/api-trpc-context'
import { ApiTrpcModule } from '../../../_module/trpc/api-trpc.module'
import { HttpErrorMiddleware } from '../../../_module/trpc/http-error.middleware'
import { ThrottleMiddleware } from '../../../_module/trpc/throttle.middleware'
import { apiErrorFormatter } from '../../../_module/trpc/trpc-error-formatter'
import {
  fakeEnvModule,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'

export async function createMixedApp({
  controllers = [],
  providers,
  configure,
}: {
  controllers?: Type[]
  providers: Provider[]
  configure?: (app: INestApplication) => void
}): Promise<NestExpressApplication> {
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
    controllers,
    providers,
  }).compile()
  const app = module.createNestApplication<NestExpressApplication>()
  configure?.(app)
  await app.init()
  return app
}
