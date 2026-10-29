import { Injectable, UnauthorizedException } from '@nestjs/common'
import type { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import { type ApiTrpcCtx, isApiTrpcCtx } from '../../../_module/trpc/api-trpc-context'
import { metaOf } from '../../../_module/trpc/procedure-meta'
import { SandboxesService } from './sandboxes.service'
import { ETokenPrincipalKind } from './token-principal'

export type SandboxTrpcCtx = ApiTrpcCtx & {
  sandbox: { threadId: string; userId: string; kind: ETokenPrincipalKind }
}

@Injectable()
export class SandboxTokenMiddleware implements TRPCMiddleware {
  constructor(private readonly sandboxes: SandboxesService) {}

  async use({ ctx, meta, next }: MiddlewareOptions): MiddlewareResponse {
    if (!isApiTrpcCtx(ctx) || ctx.bearerToken === undefined) {
      throw new UnauthorizedException('a sandbox session token is required')
    }
    const principal = await this.sandboxes.verifyTokenPrincipal({ token: ctx.bearerToken })
    if (principal.kind === ETokenPrincipalKind.Pod && metaOf(meta).podReachable !== true) {
      throw new UnauthorizedException('a sandbox session token is required')
    }
    return next({
      ctx: {
        ...ctx,
        sandbox: { threadId: principal.threadId, userId: principal.userId, kind: principal.kind },
      },
    })
  }
}
