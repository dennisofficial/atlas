import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../client-rate-limit'
import { SessionAuthGuard } from '../../_module/session/session-auth.guard'
import { assertGzipContentType, bufferBodyOf } from '../context-archive/context-archive-http'
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

  @Put(':threadId/context')
  @HttpCode(204)
  async handlePutContext(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<void> {
    assertGzipContentType(contentType)
    await this.sandboxes.putContextArchive({
      userId: userIdOf(request),
      threadId,
      archive: bufferBodyOf(body),
    })
  }
}
