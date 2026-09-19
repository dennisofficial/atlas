import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../client-rate-limit'
import { SessionAuthGuard } from '../../_module/session/session-auth.guard'
import { userIdOf } from '../sessions/session-user'
import { AttachSandboxDto } from './sandboxes.dto'
import { SandboxesService } from './sandboxes.service'
import type { SandboxAttachmentDto, SandboxStatusDto } from './sandboxes.types'

@Controller({ path: 'sandboxes', version: '1' })
@UseGuards(SessionAuthGuard)
@Throttle({ default: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttl: 60_000 } })
export class SandboxesController {
  constructor(private readonly sandboxes: SandboxesService) {}

  @Post()
  handleAttach(
    @Req() request: AuthenticatedRequest,
    @Body() body: AttachSandboxDto,
  ): Promise<SandboxAttachmentDto> {
    return this.sandboxes.attach({
      userId: userIdOf(request),
      threadId: body.threadId,
      workspace: body.workspace,
      contextBundle: body.contextBundle,
    })
  }

  @Get(':threadId')
  handleStatus(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<SandboxStatusDto> {
    return this.sandboxes.status({ userId: userIdOf(request), threadId })
  }

  @Post(':threadId/stop')
  handleStop(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<SandboxStatusDto> {
    return this.sandboxes.stop({ userId: userIdOf(request), threadId })
  }
}
