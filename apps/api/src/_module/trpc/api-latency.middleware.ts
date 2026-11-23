import { Injectable } from '@nestjs/common'
import type { ProductAnalytics } from '@dltech/atlas-observability'
import type { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import {
  captureApiRequest,
  worthReporting,
  type ApiErrorClass,
  type AuthenticatedRequest,
} from '../../api/api-latency.interceptor'
import { isApiTrpcCtx } from './api-trpc-context'
import { detailsOf } from './trpc-error-mapping'

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  PARSE_ERROR: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_SUPPORTED: 405,
  TIMEOUT: 408,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
  CLIENT_CLOSED_REQUEST: 499,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
}

const codeOf = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined
  const code = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : undefined
}

const statusOf = (error: unknown): number => {
  const code = codeOf(error)
  return code === undefined ? 500 : (STATUS_BY_CODE[code] ?? 500)
}

const causeOf = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? Reflect.get(error, 'cause') : undefined

const markerOf = (details: Record<string, unknown> | undefined): string | undefined => {
  const code = details?.code
  return typeof code === 'string' ? code : undefined
}

const podFailureOf = (details: Record<string, unknown> | undefined): string | undefined => {
  const failure = details?.podFailure
  return typeof failure === 'string' ? failure : undefined
}

const errorClassOf = (error: unknown): ApiErrorClass | undefined => {
  const code = codeOf(error)
  if (code === undefined) return undefined
  const details = detailsOf(causeOf(error))
  const marker = markerOf(details)
  const podFailure = podFailureOf(details)
  return {
    code,
    ...(marker === undefined ? {} : { marker }),
    ...(podFailure === undefined ? {} : { podFailure }),
  }
}

/**
 * The tRPC equivalent of `ApiLatencyInterceptor`: nestjs-trpc mounts each procedure as express
 * middleware, so the Nest interceptor never sees a tRPC call.
 */
@Injectable()
export class ApiLatencyMiddleware implements TRPCMiddleware {
  constructor(
    private readonly args: {
      analytics: ProductAnalytics
      userIdOf?: ((request: AuthenticatedRequest) => Promise<string | undefined>) | undefined
      now?: (() => number) | undefined
    },
  ) {}

  async use({ ctx, path, type, next }: MiddlewareOptions): MiddlewareResponse {
    if (type === 'subscription') return next()
    const now = this.args.now ?? (() => performance.now())
    const startedAt = now()
    let status = 200
    let failed = false
    let classified: ApiErrorClass | undefined
    try {
      const result = await next()
      if (!result.ok) {
        status = statusOf(result.error)
        failed = true
        classified = errorClassOf(result.error)
      }
      return result
    } catch (error) {
      status = statusOf(error)
      failed = true
      classified = errorClassOf(error)
      throw error
    } finally {
      const durationMs = Math.round(now() - startedAt)
      const request = isApiTrpcCtx(ctx) ? ctx.req : undefined
      if (request !== undefined && worthReporting({ durationMs, failed })) {
        void captureApiRequest({
          analytics: this.args.analytics,
          request,
          sample: {
            path,
            durationMs,
            status,
            failed,
            ...(classified === undefined ? {} : { error: classified }),
          },
          ...(this.args.userIdOf === undefined ? {} : { userIdOf: this.args.userIdOf }),
        })
      }
    }
  }
}
