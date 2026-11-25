import {
  projectIdInputSchema,
  projectWorkspaceSchema,
  type ProjectIdInput,
  type ProjectWorkspace,
} from '@dltech/atlas-wire'
import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { ProjectsService } from './projects.service'

@Router({ alias: 'projectWorkspace' })
@UseMiddlewares(SessionMiddleware)
export class ProjectWorkspaceRouter {
  constructor(private readonly projects: ProjectsService) {}

  @Query({
    input: projectIdInputSchema,
    output: projectWorkspaceSchema,
  })
  get(@Input() input: ProjectIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<ProjectWorkspace> {
    return this.projects.workspace({ userId: ctx.auth.userId, projectId: input.projectId })
  }
}
