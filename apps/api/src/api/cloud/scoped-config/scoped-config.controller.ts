import type { ResolvedSandboxConfig } from '@dltech/atlas-wire/web'
import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { PodReachable } from '../../../_core/decorators/pod-reachable.decorator'
import { SandboxReachable } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { db } from '../../../db'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { ScopedConfigService } from './scoped-config.service'

const machineThreadOf = (request: AuthenticatedRequest): string => {
  const threadId = request.sandbox?.threadId ?? request.pod?.threadId
  if (threadId === undefined)
    throw new ForbiddenException('only a sandbox or pod token reads its resolved config')
  return threadId
}

@Controller({ path: 'sandboxes/self', version: '1' })
@SkipThrottle()
export class ScopedConfigController {
  constructor(private readonly scoped: ScopedConfigService) {}

  @Get('config')
  @UseGuards(SessionOrSandboxGuard)
  @PodReachable()
  @SandboxReachable()
  @Header('Cache-Control', 'no-store')
  async handleConfig(
    @Req() request: AuthenticatedRequest,
    @Query('projectId') requestedProjectId: string | undefined,
  ): Promise<ResolvedSandboxConfig> {
    const userId = request.auth?.userId
    if (userId === undefined) throw new UnauthorizedException('a sandbox session token is required')
    const thread = await db.thread.findUnique({
      where: { id: machineThreadOf(request) },
      select: { projectId: true },
    })
    const given =
      requestedProjectId === undefined || requestedProjectId.length === 0
        ? null
        : requestedProjectId
    return this.scoped.resolveForPod({ userId, projectId: thread?.projectId ?? given })
  }
}
