import { Injectable, Logger } from '@nestjs/common'
import type { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import { isTrpcError, toTrpcError } from './trpc-error-mapping'

@Injectable()
export class HttpErrorMiddleware implements TRPCMiddleware {
  private readonly log = new Logger(HttpErrorMiddleware.name)

  async use({ next }: MiddlewareOptions): MiddlewareResponse {
    const result = await next()
    if (result.ok) return result
    const { error } = result
    if (isTrpcError(error) && error.code !== 'INTERNAL_SERVER_ERROR') return result
    throw toTrpcError({
      failure: isTrpcError(error) ? (error.cause ?? error) : error,
      log: this.log,
    })
  }
}
