import {
  projectGroupAssignSchema,
  projectGroupKeySchema,
  projectGroupListSchema,
  projectGroupSaveSchema,
  projectGroupSchema,
  type ProjectGroup,
  type ProjectGroupAssign,
  type ProjectGroupKey,
  type ProjectGroupList,
  type ProjectGroupSave,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { GroupsService } from './project-groups.service'

@Router({ alias: 'projectGroups' })
@UseMiddlewares(SessionMiddleware)
export class ProjectGroupsRouter {
  constructor(private readonly groups: GroupsService) {}

  @Query({ output: projectGroupListSchema })
  async list(@Ctx() ctx: SessionTrpcCtx): Promise<ProjectGroupList> {
    return { groups: await this.groups.list({ userId: ctx.auth.userId }) }
  }

  @Mutation({ input: projectGroupSaveSchema, output: projectGroupSchema })
  save(@Input() input: ProjectGroupSave, @Ctx() ctx: SessionTrpcCtx): Promise<ProjectGroup> {
    return this.groups.save({ userId: ctx.auth.userId, input })
  }

  @Mutation({ input: projectGroupKeySchema, output: z.void() })
  async remove(@Input() input: ProjectGroupKey, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.groups.remove({ userId: ctx.auth.userId, id: input.id })
  }

  @Mutation({ input: projectGroupAssignSchema, output: z.void() })
  async assign(@Input() input: ProjectGroupAssign, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.groups.assign({
      userId: ctx.auth.userId,
      projectId: input.projectId,
      groupId: input.groupId,
    })
  }
}
