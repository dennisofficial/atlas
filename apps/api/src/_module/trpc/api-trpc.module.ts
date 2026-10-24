import { Global, Module } from '@nestjs/common'
import { ApiTrpcContext } from './api-trpc-context'
import { HttpErrorMiddleware } from './http-error.middleware'

@Global()
@Module({
  providers: [ApiTrpcContext, HttpErrorMiddleware],
  exports: [ApiTrpcContext, HttpErrorMiddleware],
})
export class ApiTrpcModule {}
