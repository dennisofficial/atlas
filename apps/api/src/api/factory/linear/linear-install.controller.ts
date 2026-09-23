import {
  Controller,
  Get,
  HttpException,
  Logger,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { EnvService } from '../../../_core/config/env/env.service'
import { Public } from '../../../_core/decorators/public.decorator'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { requireOrganization } from '../require-organization'
import { LinearInstallService } from './linear-install.service'

@Controller({ path: 'factory/linear', version: '1' })
@UseGuards(SessionAuthGuard)
export class LinearInstallController {
  private readonly logger = new Logger(LinearInstallController.name)

  constructor(
    private readonly env: EnvService,
    private readonly install: LinearInstallService,
  ) {}

  @Get('install')
  handleInstall(@Req() request: AuthenticatedRequest, @Res() response: Response): void {
    const url = this.install.beginInstall({
      organizationId: requireOrganization(request),
      apiOrigin: this.env.get('BETTER_AUTH_URL'),
    })
    response.redirect(302, url)
  }

  @Get('callback')
  @Public()
  async handleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (error !== undefined || code === undefined || state === undefined) {
      response.redirect(302, this.webRedirect({ installed: 'error' }))
      return
    }

    try {
      await this.install.completeInstall({
        code,
        state,
        apiOrigin: this.env.get('BETTER_AUTH_URL'),
      })
    } catch (caught) {
      if (caught instanceof HttpException) throw caught
      this.logger.error('linear install callback failed')
      response.redirect(302, this.webRedirect({ installed: 'error' }))
      return
    }
    response.redirect(302, this.webRedirect({ installed: 'success' }))
  }

  private webRedirect(args: { installed: 'success' | 'error' }): string {
    return `${this.env.get('WEB_ORIGIN')}/factory?linear=${args.installed}`
  }
}
