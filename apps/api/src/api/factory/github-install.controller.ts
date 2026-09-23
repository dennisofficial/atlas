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
import { EnvService } from '../../_core/config/env/env.service'
import { Public } from '../../_core/decorators/public.decorator'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'
import { SessionAuthGuard } from '../../_module/session/session-auth.guard'
import { GithubInstallService } from './github-install.service'
import { requireOrganization } from './require-organization'

@Controller({ path: 'factory/github', version: '1' })
@UseGuards(SessionAuthGuard)
export class GithubInstallController {
  private readonly logger = new Logger(GithubInstallController.name)

  constructor(
    private readonly env: EnvService,
    private readonly install: GithubInstallService,
  ) {}

  @Get('install')
  async handleInstall(@Req() request: AuthenticatedRequest, @Res() response: Response): Promise<void> {
    const url = await this.install.beginInstall({
      organizationId: requireOrganization(request),
    })
    response.redirect(302, url)
  }

  @Get('callback')
  @Public()
  async handleCallback(
    @Query('installation_id') installationId: string | undefined,
    @Query('state') state: string | undefined,
    @Query('setup_action') setupAction: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (installationId === undefined || state === undefined) {
      response.redirect(302, this.webRedirect({ github: 'error' }))
      return
    }

    try {
      await this.install.completeInstall({ installationId, state })
    } catch (caught) {
      if (caught instanceof HttpException) throw caught
      this.logger.error('github install callback failed')
      response.redirect(302, this.webRedirect({ github: 'error' }))
      return
    }
    response.redirect(302, this.webRedirect({ github: 'installed' }))
  }

  private webRedirect(args: { github: 'installed' | 'error' }): string {
    return `${this.env.get('WEB_ORIGIN')}/factory?github=${args.github}`
  }
}
