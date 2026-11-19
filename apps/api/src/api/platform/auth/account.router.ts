import { db } from '@dltech/atlas-db'
import { type AccountMeOutput, accountMeOutputSchema } from '@dltech/atlas-protocol'
import { Ctx, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'

@Router({ alias: 'account' })
@UseMiddlewares(SessionMiddleware)
export class AccountRouter {
  @Query({
    input: z.strictObject({}),
    output: accountMeOutputSchema,
    meta: meta({ awaitingAccessAllowed: true }),
  })
  async me(@Ctx() ctx: SessionTrpcCtx): Promise<AccountMeOutput> {
    const user = await db.orm.public.User.first({ id: ctx.auth.userId })
    return { userId: ctx.auth.userId, email: ctx.auth.email, active: user?.active === true }
  }
}
