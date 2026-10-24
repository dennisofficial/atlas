import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import { type ApiTrpcCtx, isApiTrpcCtx } from '../../../_module/trpc/api-trpc-context'
import { SandboxesService } from './sandboxes.service'

export type SandboxThreadTrpcCtx = ApiTrpcCtx & {
  bearerToken: string
  sandbox: { threadId: string; userId: string }
}

const threadIdOf = (rawInput: unknown): string | undefined => {
  if (typeof rawInput !== 'object' || rawInput === null || !('threadId' in rawInput)) {
    return undefined
  }
  const { threadId } = rawInput
  return typeof threadId === 'string' && threadId.length > 0 ? threadId : undefined
}

@Injectable()
export class SandboxThreadTokenMiddleware implements TRPCMiddleware {
  constructor(@Inject(SandboxesService) private readonly sandboxes: SandboxesService) {}

  async use({ ctx, getRawInput, next }: MiddlewareOptions): MiddlewareResponse {
    if (!isApiTrpcCtx(ctx) || ctx.bearerToken === undefined) {
      throw new UnauthorizedException('a sandbox session token is required')
    }
    const threadId = threadIdOf(await getRawInput())
    if (threadId === undefined) {
      throw new UnauthorizedException('a sandbox session token is required')
    }
    const row = await this.sandboxes.verifySessionToken({ threadId, token: ctx.bearerToken })
    return next({ ctx: { ...ctx, sandbox: { threadId, userId: row.userId } } })
  }
}
