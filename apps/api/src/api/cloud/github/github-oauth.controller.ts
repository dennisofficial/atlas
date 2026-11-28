import { Controller, Get, Header, Headers, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { GithubRedirectService } from './github-redirect.service'

@Controller({ path: 'github/oauth', version: '1' })
export class GithubOauthController {
  constructor(private readonly redirects: GithubRedirectService) {}

  @Get('callback')
  @Header('cache-control', 'no-store')
  async handleCallback(
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const answer = await this.redirects.callback({
      state: state ?? '',
      code,
      error,
      errorDescription,
      cookieHeader,
    })
    response.setHeader('set-cookie', answer.clearCookie)
    if (answer.kind === 'redirect') {
      response.redirect(answer.location)
      return
    }
    response.type('html').send(answer.html)
  }
}
