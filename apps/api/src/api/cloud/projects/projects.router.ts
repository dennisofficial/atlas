import {
  projectIdInputSchema,
  projectListSchema,
  projectSaveSchema,
  projectSchema,
  projectUpdateSchema,
  type Project,
  type ProjectIdInput,
  type ProjectSave,
  type ProjectUpdate,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { ProjectsService } from './projects.service'

@Router({ alias: 'projects' })
@UseMiddlewares(SessionMiddleware)
export class ProjectsRouter {
  constructor(private readonly projects: ProjectsService) {}

  @Query({ output: projectListSchema })
  list(@Ctx() ctx: SessionTrpcCtx): Promise<Project[]> {
    return this.projects.list({ userId: ctx.auth.userId })
  }

  @Mutation({ input: projectSaveSchema, output: projectSchema })
  create(@Input() input: ProjectSave, @Ctx() ctx: SessionTrpcCtx): Promise<Project> {
    return this.projects.create({ userId: ctx.auth.userId, input })
  }

  @Query({ input: projectIdInputSchema, output: projectSchema })
  get(@Input() input: ProjectIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<Project> {
    return this.projects.read({ userId: ctx.auth.userId, projectId: input.projectId })
  }

  @Mutation({ input: projectUpdateSchema, output: projectSchema })
  update(@Input() input: ProjectUpdate, @Ctx() ctx: SessionTrpcCtx): Promise<Project> {
    const { projectId, ...save } = input
    return this.projects.replace({ userId: ctx.auth.userId, projectId, input: save })
  }

  @Mutation({ input: projectIdInputSchema, output: z.void() })
  async remove(@Input() input: ProjectIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.projects.remove({ userId: ctx.auth.userId, projectId: input.projectId })
  }
}
