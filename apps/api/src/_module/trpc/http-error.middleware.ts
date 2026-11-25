import { Injectable, Logger } from '@nestjs/common'
import type { ErrorReporter } from '@dltech/atlas-observability'
import type { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import { requestScopedLog } from '../../api/request-id.middleware'
import { reportableFaultOf, rootCauseOf } from './reportable-fault'
import { isTrpcError, toTrpcError } from './trpc-error-mapping'

export const API_FAULT_SOURCE = 'api.trpc'

@Injectable()
export class HttpErrorMiddleware implements TRPCMiddleware {
  private readonly log = new Logger(HttpErrorMiddleware.name)

  constructor(private readonly args: { errors: ErrorReporter }) {}

  async use({ path, next }: MiddlewareOptions): MiddlewareResponse {
    const result = await next()
    if (result.ok) return result
    const { error } = result
    if (isTrpcError(error) && error.code !== 'INTERNAL_SERVER_ERROR') return result
    const failure = isTrpcError(error) ? (error.cause ?? error) : error
    const mapped = toTrpcError({ failure, log: requestScopedLog(this.log) })
    if (mapped.code === 'INTERNAL_SERVER_ERROR') this.report({ failure, path })
    throw mapped
  }

  private report(args: { failure: unknown; path: string }): void {
    const root = rootCauseOf(args.failure)
    this.args.errors.report({
      error: reportableFaultOf({ failure: root, path: args.path }),
      properties: {
        source: API_FAULT_SOURCE,
        path: args.path,
        error_class: args.failure instanceof Error ? args.failure.name : typeof args.failure,
      },
    })
  }
}
