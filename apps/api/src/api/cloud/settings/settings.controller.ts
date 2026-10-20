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
import { SetSettingDto } from './settings.dto'
import { SettingsService } from './settings.service'
import type { SettingListDto } from './settings.types'

const NO_STORE = 'no-store'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @UseGuards(SessionOrSandboxGuard)
  @PodReachable()
  @SandboxReachable()
  @Header('Cache-Control', NO_STORE)
  async handleList(@Req() request: AuthenticatedRequest): Promise<SettingListDto> {
    return { settings: await this.settings.list({ userId: userIdOf(request) }) }
  }

  @Put(':key')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async handleSet(
    @Req() request: AuthenticatedRequest,
    @Param('key') key: string,
    @Body() body: SetSettingDto,
  ): Promise<void> {
    await this.settings.set({ userId: userIdOf(request), key, value: body.value })
  }

  @Delete(':key')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async handleRemove(
    @Req() request: AuthenticatedRequest,
    @Param('key') key: string,
  ): Promise<void> {
    await this.settings.remove({ userId: userIdOf(request), key })
  }
}
