import { Inject } from '@nestjs/common'
import {
  usageReportDtoSchema,
  usageReportInputSchema,
  type UsageReportDto,
  type UsageReportInput,
} from '@dltech/atlas-protocol'
import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'

import { USAGE, type UsageService } from '../../../agent'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'

@Router({ alias: 'usage' })
@UseMiddlewares(SessionMiddleware)
export class UsageRouter {
  constructor(@Inject(USAGE) private readonly usage: UsageService) {}

  @Query({ input: usageReportInputSchema, output: usageReportDtoSchema })
  report(@Input() input: UsageReportInput, @Ctx() ctx: SessionTrpcCtx): Promise<UsageReportDto> {
    return 'accountId' in input
      ? this.usage.report({ userId: ctx.auth.userId, accountId: input.accountId })
      : this.usage.report({ userId: ctx.auth.userId, provider: input.provider })
  }
}
