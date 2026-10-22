import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { userIdOf } from '../sessions/session-user'
import { ClaimSandboxDto } from './sandboxes.dto'
import { SandboxesService } from './sandboxes.service'
import type { SandboxAttachmentDto, SandboxListEntryDto } from './sandboxes.types'

@Controller({ path: 'sandboxes', version: '1' })
@UseGuards(SessionAuthGuard)
@Throttle({ default: { limit: CLIENT_READ_LIMIT_PER_MINUTE, ttl: 60_000 } })
export class SandboxesController {
  constructor(private readonly sandboxes: SandboxesService) {}

  @Get()
  handleList(@Req() request: AuthenticatedRequest): Promise<SandboxListEntryDto[]> {
    return this.sandboxes.list({ userId: userIdOf(request) })
  }

  @Post()
  handleClaim(
    @Req() request: AuthenticatedRequest,
    @Body() body: ClaimSandboxDto,
  ): Promise<SandboxAttachmentDto> {
    return this.sandboxes.claim({
      userId: userIdOf(request),
      threadId: body.threadId,
      gitToken: body.gitToken,
      contextPending: body.contextPending,
      ...(body.clientToken === undefined ? {} : { clientToken: body.clientToken }),
      ...(body.serveUrl === undefined ? {} : { serveUrl: body.serveUrl }),
      ...(body.serveVersion === undefined ? {} : { serveVersion: body.serveVersion }),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
    })
  }

  @Post(':threadId/destroy')
  @HttpCode(204)
  handleDestroy(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
  ): Promise<void> {
    return this.sandboxes.destroy({ userId: userIdOf(request), threadId })
  }
}
