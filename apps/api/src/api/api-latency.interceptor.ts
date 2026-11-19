import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { ProductAnalytics } from '@dltech/atlas-observability'
import { fromNodeHeaders } from 'better-auth/node'
import type { Request, Response } from 'express'
import { type Observable, catchError, tap, throwError } from 'rxjs'

const SLOW_REQUEST_MS = 1000
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export type AuthenticatedRequest = Request & { user?: { id?: unknown } | null }

export const requestPathOf = (request: Pick<Request, 'path' | 'route'>): string => {
  const raw = (request.path ?? '').split('?')[0] ?? ''
  const trpc = /\/trpc\/(.+)$/.exec(raw)
  if (trpc?.[1] !== undefined) return trpc[1]
  return (request.route?.path ?? raw).replace(UUID, ':id')
}

const userIdOf = async (request: AuthenticatedRequest): Promise<string | undefined> => {
  const attached = request.user?.id
  if (typeof attached === 'string') return attached
  try {
    const { auth } = await import('./platform/auth/auth.server.js')
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    return session?.user.id
  } catch {
    return undefined
  }
}

/**
 * Emits `api_request` only for calls worth looking at — slower than a second, or failed — so the
 * volume stays low. A request with no authenticated user is skipped rather than attributed.
 */
export class ApiLatencyInterceptor implements NestInterceptor {
  constructor(
    private readonly args: {
      analytics: ProductAnalytics
      userIdOf?: (request: AuthenticatedRequest) => Promise<string | undefined>
      now?: () => number
    },
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle()
    const now = this.args.now ?? (() => performance.now())
    const startedAt = now()
    const http = context.switchToHttp()
    const request = http.getRequest<AuthenticatedRequest>()
    const response = http.getResponse<Response>()

    const record = (status: number, failed: boolean): void => {
      const durationMs = Math.round(now() - startedAt)
      if (!failed && durationMs < SLOW_REQUEST_MS) return
      void this.capture({ request, status, durationMs, failed })
    }

    return next.handle().pipe(
      tap(() => record(response.statusCode ?? 200, false)),
      catchError((error: unknown) => {
        record(response.statusCode >= 400 ? response.statusCode : 500, true)
        return throwError(() => error)
      }),
    )
  }

  private async capture(args: {
    request: AuthenticatedRequest
    status: number
    durationMs: number
    failed: boolean
  }): Promise<void> {
    try {
      const userId = await (this.args.userIdOf ?? userIdOf)(args.request)
      if (userId === undefined) return
      this.args.analytics.capture({
        userId,
        event: 'api_request',
        properties: {
          path: requestPathOf(args.request),
          duration_ms: args.durationMs,
          status: args.status,
          failed: args.failed,
        },
      })
    } catch {
      // A latency sample is never worth faulting the request it measured.
    }
  }
}
