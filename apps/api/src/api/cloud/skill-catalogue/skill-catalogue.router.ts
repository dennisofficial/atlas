import {
  skillCatalogueReplySchema,
  skillCatalogueRequestSchema,
  type SkillCatalogueReply,
} from '@dltech/atlas-wire'
import { Ctx, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { SkillCatalogueService } from './skill-catalogue.service'

@Router({ alias: 'skillCatalogue' })
@UseMiddlewares(SessionMiddleware)
export class SkillCatalogueRouter {
  constructor(private readonly catalogue: SkillCatalogueService) {}

  @Query({ input: skillCatalogueRequestSchema, output: skillCatalogueReplySchema })
  async list(@Ctx() ctx: SessionTrpcCtx): Promise<SkillCatalogueReply> {
    const { userId } = ctx.auth
    return { skills: await this.catalogue.list({ userId }) }
  }
}
