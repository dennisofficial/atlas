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
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { CLIENT_READ_LIMIT_PER_MINUTE } from '../../client-rate-limit'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { assertGzipContentType, bufferBodyOf } from '../../cloud/context-archive/context-archive-http'
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
      workspace: body.workspace,
      contextBundle: body.contextBundle,
      gitToken: body.gitToken,
      gpgKey: body.gpgKey,
      driveName: body.driveName,
      contextPending: body.contextPending,
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

  @Put(':threadId/transcript')
  @HttpCode(204)
  async handlePutTranscript(
    @Req() request: AuthenticatedRequest,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<void> {
    assertGzipContentType(contentType)
    await this.sandboxes.putTranscriptArchive({
      userId: userIdOf(request),
      threadId,
      archive: bufferBodyOf(body),
    })
  }
}
