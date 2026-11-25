import { accountLeaseSchema, type AccountLease } from '@dltech/atlas-wire'
import { Ctx, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { AccountsService } from './accounts.service'

@Router({ alias: 'accountLease' })
@UseMiddlewares(SessionMiddleware)
export class AccountLeaseRouter {
  constructor(private readonly accounts: AccountsService) {}

  @Query({
    output: accountLeaseSchema,
  })
  get(@Ctx() ctx: SessionTrpcCtx): Promise<AccountLease> {
    return this.accounts.lease({ userId: ctx.auth.userId })
  }
}
