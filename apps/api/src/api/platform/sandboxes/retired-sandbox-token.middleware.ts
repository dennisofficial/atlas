import { Injectable, UnauthorizedException } from '@nestjs/common'
import type { MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import type { ApiTrpcCtx } from '../../../_module/trpc/api-trpc-context'

export type SandboxTrpcCtx = ApiTrpcCtx & {
  sandbox: { threadId: string; userId: string }
}

@Injectable()
export class RetiredSandboxTokenMiddleware implements TRPCMiddleware {
  use(): MiddlewareResponse {
    throw new UnauthorizedException('sandbox tokens are retired')
  }
}
