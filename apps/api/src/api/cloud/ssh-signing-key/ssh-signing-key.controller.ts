import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { SshSigningKeyLease, SshSigningKeyStatus } from '@dltech/atlas-wire'
import { PodReachable } from '../../../_core/decorators/pod-reachable.decorator'
import { SandboxReachable } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { SigningKeyUploadDto } from './ssh-signing-key.dto'
import { SshSigningKeyService } from './ssh-signing-key.service'

const NO_STORE = 'no-store'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'ssh-signing-key', version: '1' })
export class SshSigningKeyController {
  constructor(private readonly keys: SshSigningKeyService) {}

  @Get()
  @UseGuards(SessionOrSandboxGuard)
  @PodReachable()
  @SandboxReachable()
  @Header('Cache-Control', NO_STORE)
  handleLease(@Req() request: AuthenticatedRequest): Promise<SshSigningKeyLease> {
    return this.keys.lease({ userId: userIdOf(request) })
  }

  @Get('status')
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', NO_STORE)
  handleStatus(@Req() request: AuthenticatedRequest): Promise<SshSigningKeyStatus> {
    return this.keys.status({ userId: userIdOf(request) })
  }

  @Post()
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', NO_STORE)
  handleRegister(
    @Req() request: AuthenticatedRequest,
    @Body() body: SigningKeyUploadDto,
  ): Promise<SshSigningKeyStatus> {
    return this.keys.register({ userId: userIdOf(request), privateKey: body.privateKey })
  }

  @Post('rotate')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', NO_STORE)
  handleRotate(
    @Req() request: AuthenticatedRequest,
    @Body() body: SigningKeyUploadDto,
  ): Promise<SshSigningKeyStatus> {
    return this.keys.rotate({ userId: userIdOf(request), privateKey: body.privateKey })
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async handleRevoke(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.keys.revoke({ userId: userIdOf(request) })
  }
}
