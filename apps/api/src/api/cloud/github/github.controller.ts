import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { PollGithubConnectDto } from './github.dto'
import { GithubService } from './github.service'
import type {
  GithubConnectionDto,
  GithubDeviceCodesDto,
  GithubPollResultDto,
  GithubTokenDto,
} from './github.types'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'github', version: '1' })
@UseGuards(SessionAuthGuard)
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Post('connect/begin')
  handleBeginConnect(): Promise<GithubDeviceCodesDto> {
    return this.github.beginConnect()
  }

  @Post('connect/poll')
  handlePollConnect(
    @Req() request: AuthenticatedRequest,
    @Body() body: PollGithubConnectDto,
  ): Promise<GithubPollResultDto> {
    return this.github.pollConnect({ userId: userIdOf(request), deviceCode: body.deviceCode })
  }

  @Get()
  handleRead(@Req() request: AuthenticatedRequest): Promise<GithubConnectionDto> {
    return this.github.read({ userId: userIdOf(request) })
  }

  @Get('token')
  handleReadToken(@Req() request: AuthenticatedRequest): Promise<GithubTokenDto> {
    return this.github.readToken({ userId: userIdOf(request) })
  }

  @Delete()
  @HttpCode(204)
  async handleDisconnect(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.github.disconnect({ userId: userIdOf(request) })
  }
}
