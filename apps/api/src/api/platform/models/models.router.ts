import { modelsResponseSchema, type ModelsResponse } from '@dltech/atlas-wire'
import { Ctx, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { ModelsService } from './models.service'

@Router({ alias: 'models' })
@UseMiddlewares(SessionMiddleware)
export class ModelsRouter {
  constructor(private readonly models: ModelsService) {}

  @Query({ output: modelsResponseSchema })
  list(@Ctx() ctx: SessionTrpcCtx): Promise<ModelsResponse> {
    return this.models.list({ userId: ctx.auth.userId })
  }
}
