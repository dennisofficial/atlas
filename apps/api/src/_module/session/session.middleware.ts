import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { TRPCError } from '@trpc/server'
import type { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import { AWAITING_ACCESS, AwaitingAccessError } from '../../_core/errors/awaiting-access.error'
import type { SessionVerifier, SessionVerifyOptions } from '../../_core/ports/session-verifier'
import { SESSION_VERIFIER } from '../../_core/ports/session-verifier'
import type { VerifiedSession } from '../../_core/types/auth.types'
import { type ApiTrpcCtx, isApiTrpcCtx } from '../trpc/api-trpc-context'
import { metaOf } from '../trpc/procedure-meta'

export type SessionTrpcCtx = ApiTrpcCtx & { auth: VerifiedSession }

@Injectable()
export class SessionMiddleware implements TRPCMiddleware {
  constructor(@Inject(SESSION_VERIFIER) private readonly verifier: SessionVerifier) {}

  async use({ ctx, meta, next }: MiddlewareOptions): MiddlewareResponse {
    const options = metaOf(meta)
    if (options.public === true) return next()
    if (!isApiTrpcCtx(ctx)) throw new UnauthorizedException('a valid session is required')
    const auth = await this.verify(ctx.req, {
      allowInactive: options.awaitingAccessAllowed === true,
    })
    if (!auth) throw new UnauthorizedException('a valid session is required')
    return next({ ctx: { ...ctx, auth } })
  }

  private async verify(
    request: Parameters<SessionVerifier['verify']>[0],
    options: SessionVerifyOptions,
  ): Promise<VerifiedSession | null> {
    try {
      return await this.verifier.verify(request, options)
    } catch (cause) {
      if (cause instanceof AwaitingAccessError) {
        throw new TRPCError({ code: 'FORBIDDEN', message: AWAITING_ACCESS })
      }
      throw cause
    }
  }
}
