import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import {
  servicesLogInputSchema,
  servicesLogOutputSchema,
  type ServicesLogInput,
  type ServicesLogOutput,
} from '@dltech/atlas-protocol'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { ServicesService } from './services.service'

@Router({ alias: 'services' })
@UseMiddlewares(SessionMiddleware)
export class ServicesRouter {
  constructor(private readonly services: ServicesService) {}

  @Query({ input: servicesLogInputSchema, output: servicesLogOutputSchema })
  log(@Input() input: ServicesLogInput, @Ctx() ctx: SessionTrpcCtx): Promise<ServicesLogOutput> {
    return this.services.log({ userId: ctx.auth.userId, ...input })
  }
}
