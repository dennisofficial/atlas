import { Global, Module } from '@nestjs/common'
import { ApiTrpcContext } from './api-trpc-context'
import { HttpErrorMiddleware } from './http-error.middleware'
import { ThrottleMiddleware } from './throttle.middleware'

@Global()
@Module({
  providers: [ApiTrpcContext, HttpErrorMiddleware, ThrottleMiddleware],
  exports: [ApiTrpcContext, HttpErrorMiddleware, ThrottleMiddleware],
})
export class ApiTrpcModule {}
