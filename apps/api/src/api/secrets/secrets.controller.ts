import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '@core/types/auth.types'
import { SessionAuthGuard } from '@module/session/session-auth.guard'
import { SetSecretDto } from './secrets.dto'
import { SecretsService } from './secrets.service'
import type { SecretListDto } from './secrets.types'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'secrets', version: '1' })
@UseGuards(SessionAuthGuard)
export class SecretsController {
  constructor(private readonly secrets: SecretsService) {}

  @Get()
  async handleList(@Req() request: AuthenticatedRequest): Promise<SecretListDto> {
    return { secrets: await this.secrets.list({ userId: userIdOf(request) }) }
  }

  @Put(':name')
  @HttpCode(204)
  async handleSet(
    @Req() request: AuthenticatedRequest,
    @Param('name') name: string,
    @Body() body: SetSecretDto,
  ): Promise<void> {
    await this.secrets.set({ userId: userIdOf(request), name, value: body.value })
  }

  @Delete(':name')
  @HttpCode(204)
  async handleRemove(
    @Req() request: AuthenticatedRequest,
    @Param('name') name: string,
  ): Promise<void> {
    await this.secrets.remove({ userId: userIdOf(request), name })
  }
}
