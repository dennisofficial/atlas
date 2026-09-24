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
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { SetSettingDto } from './settings.dto'
import { SettingsService } from './settings.service'
import type { SettingListDto } from './settings.types'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'settings', version: '1' })
@UseGuards(SessionAuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async handleList(@Req() request: AuthenticatedRequest): Promise<SettingListDto> {
    return { settings: await this.settings.list({ userId: userIdOf(request) }) }
  }

  @Put(':key')
  @HttpCode(204)
  async handleSet(
    @Req() request: AuthenticatedRequest,
    @Param('key') key: string,
    @Body() body: SetSettingDto,
  ): Promise<void> {
    await this.settings.set({ userId: userIdOf(request), key, value: body.value })
  }

  @Delete(':key')
  @HttpCode(204)
  async handleRemove(
    @Req() request: AuthenticatedRequest,
    @Param('key') key: string,
  ): Promise<void> {
    await this.settings.remove({ userId: userIdOf(request), key })
  }
}
