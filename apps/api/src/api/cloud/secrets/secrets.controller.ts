import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { PodReachable } from '../../../_core/decorators/pod-reachable.decorator'
import { SandboxReachable } from '../../../_core/decorators/sandbox-reachable.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { SessionOrSandboxGuard } from '../../platform/sessions/session-or-sandbox.guard'
import { SetSecretDto } from './secrets.dto'
import { SecretsService } from './secrets.service'
import type { SecretDetailListDto, SecretListDto } from './secrets.types'

const NO_STORE = 'no-store'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'secrets', version: '1' })
export class SecretsController {
  constructor(private readonly secrets: SecretsService) {}

  @Get()
  @UseGuards(SessionOrSandboxGuard)
  @PodReachable()
  @SandboxReachable()
  @Header('Cache-Control', NO_STORE)
  async handleList(@Req() request: AuthenticatedRequest): Promise<SecretListDto> {
    return { secrets: await this.secrets.list({ userId: userIdOf(request) }) }
  }

  @Get('details')
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', NO_STORE)
  async handleListDetails(@Req() request: AuthenticatedRequest): Promise<SecretDetailListDto> {
    return { secrets: await this.secrets.listDetails({ userId: userIdOf(request) }) }
  }

  @Put(':name')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async handleSet(
    @Req() request: AuthenticatedRequest,
    @Param('name') name: string,
    @Body() body: SetSecretDto,
  ): Promise<void> {
    await this.secrets.set({
      userId: userIdOf(request),
      name,
      value: body.value,
      kind: body.kind,
    })
  }

  @Delete(':name')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async handleRemove(
    @Req() request: AuthenticatedRequest,
    @Param('name') name: string,
  ): Promise<void> {
    await this.secrets.remove({ userId: userIdOf(request), name })
  }
}
