import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { SandboxReachable } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { SessionOrSandboxGuard } from '../sessions/session-or-sandbox.guard'
import { AccessTokenRequestDto, ReauthorizeConnectionDto, UploadConnectionDto } from './oauth-connections.dto'
import { OauthConnectionsService } from './oauth-connections.service'
import type { AccessTokenDto } from './oauth-connections.types'

const NO_STORE = 'no-store'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'oauth-connections', version: '1' })
export class OauthConnectionsController {
  constructor(private readonly connections: OauthConnectionsService) {}

  @Put(':connectionId')
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', NO_STORE)
  handleUpload(
    @Req() request: AuthenticatedRequest,
    @Param('connectionId') connectionId: string,
    @Body() body: UploadConnectionDto,
  ): Promise<AccessTokenDto> {
    return this.connections.upload({ userId: userIdOf(request), connectionId, draft: body })
  }

  @Get(':connectionId')
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', NO_STORE)
  handleMetadata(
    @Req() request: AuthenticatedRequest,
    @Param('connectionId') connectionId: string,
  ) {
    return this.connections.metadata({ userId: userIdOf(request), connectionId })
  }

  @Put(':connectionId/reauthorize')
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', NO_STORE)
  handleReauthorize(
    @Req() request: AuthenticatedRequest,
    @Param('connectionId') connectionId: string,
    @Body() body: ReauthorizeConnectionDto,
  ): Promise<AccessTokenDto> {
    return this.connections.reauthorize({ userId: userIdOf(request), connectionId, draft: body })
  }

  @Post(':connectionId/access-token')
  @HttpCode(200)
  @UseGuards(SessionOrSandboxGuard)
  @SandboxReachable()
  @Header('Cache-Control', NO_STORE)
  handleAccessToken(
    @Req() request: AuthenticatedRequest,
    @Param('connectionId') connectionId: string,
    @Body() body: AccessTokenRequestDto,
  ): Promise<AccessTokenDto> {
    return this.connections.issueAccessToken({
      userId: userIdOf(request),
      connectionId,
      ...(request.sandbox === undefined ? {} : { sandboxId: request.sandbox.sandboxId }),
      ...(body.rejectedAccessToken === undefined
        ? {}
        : { rejectedAccessToken: body.rejectedAccessToken }),
    })
  }

  @Put(':connectionId/sandboxes/:threadId')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async handleAssign(
    @Req() request: AuthenticatedRequest,
    @Param('connectionId') connectionId: string,
    @Param('threadId') threadId: string,
  ): Promise<void> {
    await this.connections.assignSandbox({ userId: userIdOf(request), connectionId, threadId })
  }

  @Delete(':connectionId')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async handleRemove(
    @Req() request: AuthenticatedRequest,
    @Param('connectionId') connectionId: string,
  ): Promise<void> {
    await this.connections.remove({ userId: userIdOf(request), connectionId })
  }
}
