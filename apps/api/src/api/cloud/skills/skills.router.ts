import {
  ESkillScope,
  skillGetRequestSchema,
  skillListFilesReplySchema,
  skillListFilesRequestSchema,
  skillListReplySchema,
  skillListRequestSchema,
  skillFileContentSchema,
  skillLayersSchema,
  skillPutRequestSchema,
  skillRemovedReplySchema,
  skillRemoveRequestSchema,
  skillRemoveSkillReplySchema,
  skillRemoveSkillRequestSchema,
  skillRevisionReplySchema,
  type SkillPutRequest,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import type { SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { SkillsService } from './skills.service'

@Router({ alias: 'skills' })
@UseMiddlewares(SessionMiddleware)
export class SkillsRouter {
  constructor(private readonly skills: SkillsService) {}

  @Query({
    input: skillListRequestSchema,
    output: skillListReplySchema,
  })
  async list(@Input() input: SkillScopeArgs, @Ctx() ctx: SessionTrpcCtx) {
    const skills = await this.skills.list({ userId: ctx.auth.userId, ...input })
    return { skills }
  }

  @Query({
    input: skillListRequestSchema,
    output: skillLayersSchema,
  })
  layered(@Input() input: SkillScopeArgs, @Ctx() ctx: SessionTrpcCtx) {
    return this.skills.layered({ userId: ctx.auth.userId, ...input })
  }

  @Query({
    input: skillListFilesRequestSchema,
    output: skillListFilesReplySchema,
  })
  async listFiles(@Input() input: SkillScopeArgs & { skill: string }, @Ctx() ctx: SessionTrpcCtx) {
    const files = await this.skills.listFiles({ userId: ctx.auth.userId, ...input })
    return { files }
  }

  @Query({
    input: skillGetRequestSchema,
    output: skillFileContentSchema,
  })
  get(
    @Input() input: SkillScopeArgs & { skill: string; path: string },
    @Ctx() ctx: SessionTrpcCtx,
  ) {
    return this.skills.get({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({
    input: skillPutRequestSchema,
    output: skillRevisionReplySchema,
  })
  put(@Input() input: SkillPutRequest, @Ctx() ctx: SessionTrpcCtx) {
    return this.skills.put({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({
    input: skillRemoveRequestSchema,
    output: skillRemovedReplySchema,
  })
  remove(
    @Input() input: SkillScopeArgs & { skill: string; path: string; baseRevision: number },
    @Ctx() ctx: SessionTrpcCtx,
  ) {
    return this.skills.remove({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({
    input: skillRemoveSkillRequestSchema,
    output: skillRemoveSkillReplySchema,
  })
  removeSkill(@Input() input: SkillScopeArgs & { skill: string }, @Ctx() ctx: SessionTrpcCtx) {
    return this.skills.removeSkill({ userId: ctx.auth.userId, ...input })
  }
}

type SkillScopeArgs = {
  scope: ESkillScope
  projectId?: string | undefined
  groupId?: string | undefined
}
