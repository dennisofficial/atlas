import {
  BROWSER_RETURN_START_PATH,
  RETURN_PORT_PARAM,
  RETURN_SURFACE_PARAM,
} from '@dltech/atlas-core'
import { Controller, Get, Inject, Param, Req, Res, VERSION_NEUTRAL } from '@nestjs/common'

import type { HostReply, HostRequest } from '../http/host-request'
import { BROWSER_RETURN } from '../host/tokens'
import type { BrowserReturnService } from './service'

@Controller({ version: VERSION_NEUTRAL })
export class BrowserReturnController {
  constructor(@Inject(BROWSER_RETURN) private readonly returns: BrowserReturnService) {}

  @Get(`${BROWSER_RETURN_START_PATH}/:state`)
  async handleStart(
    @Param('state') state: string,
    @Req() request: HostRequest,
    @Res() response: HostReply,
  ): Promise<void> {
    const query = new URL(request.url, 'http://agent-host').searchParams
    const answer = await this.returns.start({
      state,
      surface: query.get(RETURN_SURFACE_PARAM),
      port: query.get(RETURN_PORT_PARAM),
    })
    response.setHeader('cache-control', 'no-store')
    if (answer.kind === 'gone') {
      response.status(410)
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.send(answer.html)
      return
    }
    response.status(302)
    response.setHeader('set-cookie', answer.cookie)
    response.setHeader('location', answer.location)
    response.end()
  }
}
