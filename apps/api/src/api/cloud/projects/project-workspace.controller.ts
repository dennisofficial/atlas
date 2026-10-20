import type { ProjectWorkspace } from '@dltech/atlas-wire'
import {
  Controller,
  Get,
  Header,
  Param,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { PodReachable } from '../../../_core/decorators/pod-reachable.decorator'
import { SandboxReachable } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { ProjectsService } from './projects.service'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'projects', version: '1' })
@SkipThrottle()
export class ProjectWorkspaceController {
  constructor(private readonly projects: ProjectsService) {}

  @Get(':projectId/workspace')
  @UseGuards(SessionOrSandboxGuard)
  @PodReachable()
  @SandboxReachable()
  @Header('Cache-Control', 'no-store')
  handleWorkspace(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
  ): Promise<ProjectWorkspace> {
    return this.projects.workspace({ userId: userIdOf(request), projectId })
  }
}
