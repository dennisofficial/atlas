import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { requireOrganization } from '../require-organization'
import { PutModelDto, PutVercelDto } from './org-settings.dto'
import { OrgSettingsService, type OrgSettingsDto } from './org-settings.service'

@Controller({ path: 'factory/settings', version: '1' })
@UseGuards(SessionAuthGuard)
export class OrgSettingsController {
  constructor(private readonly settings: OrgSettingsService) {}

  @Get()
  async handleGet(@Req() request: AuthenticatedRequest): Promise<OrgSettingsDto> {
    return this.settings.getSettings({ organizationId: requireOrganization(request) })
  }

  @Put('model')
  async handlePutModel(
    @Req() request: AuthenticatedRequest,
    @Body() body: PutModelDto,
  ): Promise<{ ok: true }> {
    await this.settings.putModel({
      organizationId: requireOrganization(request),
      apiKey: body.apiKey,
      modelRef: body.modelRef,
    })
    return { ok: true }
  }

  @Put('vercel')
  async handlePutVercel(
    @Req() request: AuthenticatedRequest,
    @Body() body: PutVercelDto,
  ): Promise<{ ok: true }> {
    await this.settings.putVercel({
      organizationId: requireOrganization(request),
      token: body.token,
    })
    return { ok: true }
  }
}
