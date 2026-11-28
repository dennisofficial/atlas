import { Controller, Get, Query, Req, Res, VERSION_NEUTRAL } from '@nestjs/common'
import type { Request, Response } from 'express'
import { GoogleLinkService } from './google-link.service'

@Controller({ path: 'google-link', version: VERSION_NEUTRAL })
export class GoogleLinkController {
  constructor(private readonly google: GoogleLinkService) {}

  @Get('start')
  async handleStart(
    @Query('state') state: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader('cache-control', 'no-store')
    try {
      const started = await this.google.start(state)
      const cookies = started.headers.getSetCookie()
      if (cookies.length > 0) response.setHeader('set-cookie', cookies)
      const payload: unknown = await started.json()
      if (
        started.ok &&
        typeof payload === 'object' &&
        payload !== null &&
        'url' in payload &&
        typeof payload.url === 'string'
      ) {
        response.redirect(payload.url)
        return
      }
    } catch {}
    const answer = await this.google.callback({
      state,
      error: 'link_failed',
      cookieHeader: request.headers.cookie,
    })
    response.setHeader('set-cookie', answer.clearCookie)
    if (answer.kind === 'redirect') response.redirect(answer.location)
    else response.type('html').send(answer.html)
  }

  @Get('callback')
  async handleCallback(
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const answer = await this.google.callback({
      state,
      error,
      cookieHeader: request.headers.cookie,
    })
    response.setHeader('cache-control', 'no-store')
    response.setHeader('set-cookie', answer.clearCookie)
    if (answer.kind === 'redirect') response.redirect(answer.location)
    else response.type('html').send(answer.html)
  }
}
