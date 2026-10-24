import { accountLeaseSchema, type AccountLease } from '@dltech/atlas-wire'
import { Ctx, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../sessions/session-or-sandbox.middleware'
import { AccountsService } from './accounts.service'
import { markNoStore } from '../no-store'

@Router({ alias: 'accountLease' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class AccountLeaseRouter {
  constructor(private readonly accounts: AccountsService) {}

  @Query({
    output: accountLeaseSchema,
    meta: meta({ podReachable: true, sandboxReachable: true }),
  })
  get(@Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<AccountLease> {
    markNoStore(ctx)
    return this.accounts.lease({ userId: ctx.auth.userId })
  }
}
