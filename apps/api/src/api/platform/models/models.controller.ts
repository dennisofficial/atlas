import { Controller, Get, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import type { ModelsResponse } from '@dltech/atlas-wire/web'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { ModelsService } from './models.service'

@Controller({ path: 'models', version: '1' })
@UseGuards(SessionAuthGuard)
export class ModelsController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  handleList(@Req() request: AuthenticatedRequest): Promise<ModelsResponse> {
    const auth = request.auth
    if (!auth) throw new UnauthorizedException('a valid session is required')
    return this.models.list({ userId: auth.userId })
  }
}
