import { ForbiddenException, Injectable } from '@nestjs/common'
import type { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import { EnvService } from '../../../_core/config/env/env.service'
import type { SessionTrpcCtx } from '../../../_module/session/session.middleware'

@Injectable()
export class V2UserMiddleware implements TRPCMiddleware {
  constructor(private readonly env: EnvService) {}

  async use({ ctx, next }: MiddlewareOptions): MiddlewareResponse {
    const allowlist = (this.env.get('V2_USER_IDS') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
    const auth = (ctx as Partial<SessionTrpcCtx>).auth
    if (auth === undefined || !allowlist.includes(auth.userId)) {
      throw new ForbiddenException('the v2 namespace is not open to this account')
    }
    return next()
  }
}
