import {
  ESkillScope,
  skillGetRequestSchema,
  skillListFilesReplySchema,
  skillListFilesRequestSchema,
  skillListReplySchema,
  skillListRequestSchema,
  skillFileContentSchema,
  skillPutRequestSchema,
  skillRemovedReplySchema,
  skillRemoveRequestSchema,
  skillRemoveSkillReplySchema,
  skillRemoveSkillRequestSchema,
  skillRevisionReplySchema,
  type SkillPutRequest,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { meta } from '../../../_module/trpc/procedure-meta'
import { SessionOrSandboxMiddleware } from '../../platform/sessions/session-or-sandbox.middleware'
import type { SessionOrSandboxTrpcCtx } from '../../platform/sessions/session-or-sandbox.middleware'
import { SkillsService } from './skills.service'

const SANDBOX_REACHABLE = meta({ sandboxReachable: true })

@Router({ alias: 'skills' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class SkillsRouter {
  constructor(private readonly skills: SkillsService) {}

  @Query({
    input: skillListRequestSchema,
    output: skillListReplySchema,
    meta: SANDBOX_REACHABLE,
  })
  async list(@Input() input: SkillScopeArgs, @Ctx() ctx: SessionOrSandboxTrpcCtx) {
    const skills = await this.skills.list({ userId: ctx.auth.userId, ...input })
    return { skills }
  }

  @Query({
    input: skillListFilesRequestSchema,
    output: skillListFilesReplySchema,
    meta: SANDBOX_REACHABLE,
  })
  async listFiles(
    @Input() input: SkillScopeArgs & { skill: string },
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ) {
    const files = await this.skills.listFiles({ userId: ctx.auth.userId, ...input })
    return { files }
  }

  @Query({
    input: skillGetRequestSchema,
    output: skillFileContentSchema,
    meta: SANDBOX_REACHABLE,
  })
  get(
    @Input() input: SkillScopeArgs & { skill: string; path: string },
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ) {
    return this.skills.get({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({
    input: skillPutRequestSchema,
    output: skillRevisionReplySchema,
    meta: SANDBOX_REACHABLE,
  })
  put(@Input() input: SkillPutRequest, @Ctx() ctx: SessionOrSandboxTrpcCtx) {
    return this.skills.put({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({
    input: skillRemoveRequestSchema,
    output: skillRemovedReplySchema,
    meta: SANDBOX_REACHABLE,
  })
  remove(
    @Input() input: SkillScopeArgs & { skill: string; path: string; baseRevision: number },
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ) {
    return this.skills.remove({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({
    input: skillRemoveSkillRequestSchema,
    output: skillRemoveSkillReplySchema,
    meta: SANDBOX_REACHABLE,
  })
  removeSkill(
    @Input() input: SkillScopeArgs & { skill: string },
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ) {
    return this.skills.removeSkill({ userId: ctx.auth.userId, ...input })
  }
}

type SkillScopeArgs = { scope: ESkillScope; projectId?: string | undefined }
