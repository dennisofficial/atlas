import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import type { SessionVerifier } from '../../../_core/ports/session-verifier'
import { UserVercelService } from './user-vercel.service'

const text = (value: unknown): string | undefined | null =>
  value === undefined ? undefined : typeof value === 'string' ? value : null

@Controller({ path: 'vercel/oauth', version: '1' })
export class VercelOauthCallbackController {
  constructor(
    private readonly vercel: UserVercelService,
    @Inject(SESSION_VERIFIER) private readonly verifier: SessionVerifier,
  ) {}

  @Get('callback')
  async handleCallback(
    @Query('state') state: unknown,
    @Query('code') code: unknown,
    @Query('error') error: unknown,
    @Query('error_description') errorDescription: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const values = [text(state), text(code), text(error), text(errorDescription)]
    const session = await this.verifier.verify(request).catch(() => null)
    const location = await this.vercel.completeCallback({
      state: values[0] ?? undefined,
      code: values[1] ?? undefined,
      error: values[2] ?? undefined,
      errorDescription: values[3] ?? undefined,
      sessionUserId: session?.userId,
    })
    response.redirect(302, location)
  }
}
