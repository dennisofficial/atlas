import { Injectable, UnauthorizedException } from '@nestjs/common'
import type { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import { EnvService } from '../../../_core/config/env/env.service'
import { isApiTrpcCtx } from '../../../_module/trpc/api-trpc-context'
import { constantTimeEquals } from './host-token'

@Injectable()
export class HostTokenMiddleware implements TRPCMiddleware {
  constructor(private readonly env: EnvService) {}

  async use({ ctx, next }: MiddlewareOptions): Promise<MiddlewareResponse> {
    const expected = this.env.get('AGENT_HOST_TOKEN')
    if (!isApiTrpcCtx(ctx) || ctx.bearerToken === undefined || expected === undefined) {
      throw new UnauthorizedException('an agent host token is required')
    }
    if (!constantTimeEquals({ offered: ctx.bearerToken, expected })) {
      throw new UnauthorizedException('an agent host token is required')
    }
    return next({ ctx })
  }
}
