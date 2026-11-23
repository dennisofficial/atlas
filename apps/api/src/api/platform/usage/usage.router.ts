import { Inject, Optional } from '@nestjs/common'
import {
  usageReportDtoSchema,
  usageReportInputSchema,
  type UsageReportDto,
  type UsageReportInput,
} from '@dltech/atlas-protocol'
import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'

import { USAGE, type UsageService } from '../../../agent'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'

const UNREAD: UsageReportDto = {
  accountId: null,
  label: null,
  metered: false,
  fiveHour: null,
  sevenDay: null,
  fetchedAt: null,
}

@Router({ alias: 'usage' })
@UseMiddlewares(SessionMiddleware)
export class UsageRouter {
  constructor(@Optional() @Inject(USAGE) private readonly usage: UsageService | null = null) {}

  @Query({ input: usageReportInputSchema, output: usageReportDtoSchema })
  report(@Input() input: UsageReportInput, @Ctx() ctx: SessionTrpcCtx): Promise<UsageReportDto> {
    if (this.usage === null) return Promise.resolve(UNREAD)
    return 'accountId' in input
      ? this.usage.report({ userId: ctx.auth.userId, accountId: input.accountId })
      : this.usage.report({ userId: ctx.auth.userId, provider: input.provider })
  }
}
