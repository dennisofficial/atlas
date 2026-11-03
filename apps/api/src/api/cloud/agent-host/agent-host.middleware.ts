import { timingSafeEqual } from 'node:crypto'
import { Injectable, UnauthorizedException } from '@nestjs/common'
import type { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import { EnvService } from '../../../_core/config/env/env.service'
import { type ApiTrpcCtx, isApiTrpcCtx } from '../../../_module/trpc/api-trpc-context'

const tokenMatches = (args: { presented: string; expected: string }): boolean => {
  const presented = Buffer.from(args.presented)
  const expected = Buffer.from(args.expected)
  return presented.length === expected.length && timingSafeEqual(presented, expected)
}

@Injectable()
export class AgentHostMiddleware implements TRPCMiddleware {
  constructor(private readonly env: EnvService) {}

  async use({ ctx, next }: MiddlewareOptions): MiddlewareResponse {
    const expected = this.env.get('AGENT_HOST_TOKEN')
    if (expected === undefined || !isApiTrpcCtx(ctx)) {
      throw new UnauthorizedException('agent-host authentication is not configured')
    }
    const presented = (ctx as ApiTrpcCtx).bearerToken
    if (presented === undefined || !tokenMatches({ presented, expected })) {
      throw new UnauthorizedException('a valid agent-host token is required')
    }
    return next()
  }
}
