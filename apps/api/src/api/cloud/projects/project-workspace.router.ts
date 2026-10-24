import {
  projectIdInputSchema,
  projectWorkspaceSchema,
  type ProjectIdInput,
  type ProjectWorkspace,
} from '@dltech/atlas-wire'
import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { ProjectsService } from './projects.service'

@Router({ alias: 'projectWorkspace' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class ProjectWorkspaceRouter {
  constructor(private readonly projects: ProjectsService) {}

  @Query({
    input: projectIdInputSchema,
    output: projectWorkspaceSchema,
    meta: meta({ podReachable: true, sandboxReachable: true, throttle: false }),
  })
  get(
    @Input() input: ProjectIdInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ProjectWorkspace> {
    return this.projects.workspace({ userId: ctx.auth.userId, projectId: input.projectId })
  }
}
