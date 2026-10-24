import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import type { SessionVerifier } from '../../_core/ports/session-verifier'
import { SESSION_VERIFIER } from '../../_core/ports/session-verifier'
import type { VerifiedSession } from '../../_core/types/auth.types'
import { type ApiTrpcCtx, isApiTrpcCtx } from '../trpc/api-trpc-context'
import { metaOf } from '../trpc/procedure-meta'

export type SessionTrpcCtx = ApiTrpcCtx & { auth: VerifiedSession }

@Injectable()
export class SessionMiddleware implements TRPCMiddleware {
  constructor(@Inject(SESSION_VERIFIER) private readonly verifier: SessionVerifier) {}

  async use({ ctx, meta, next }: MiddlewareOptions): MiddlewareResponse {
    if (metaOf(meta).public === true) return next()
    if (!isApiTrpcCtx(ctx)) throw new UnauthorizedException('a valid session is required')
    const auth = await this.verifier.verify(ctx.req)
    if (!auth) throw new UnauthorizedException('a valid session is required')
    return next({ ctx: { ...ctx, auth } })
  }
}
