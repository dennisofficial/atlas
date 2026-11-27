import { Controller, Get, Inject, Req, Res, VERSION_NEUTRAL } from '@nestjs/common'

import { MCP_OAUTH_CALLBACK_PATH, type CallbackHandler } from '../mcp-oauth/callback'
import { MCP_OAUTH_CALLBACK } from '../host/tokens'
import type { HostReply, HostRequest } from './host-request'

const queryOf = (request: HostRequest): URLSearchParams =>
  new URL(request.url, 'http://agent-host').searchParams

const cookieOf = (request: HostRequest): string | undefined => {
  const header = request.headers.cookie
  return typeof header === 'string' ? header : undefined
}

@Controller({ version: VERSION_NEUTRAL })
export class McpOauthCallbackController {
  constructor(@Inject(MCP_OAUTH_CALLBACK) private readonly callback: CallbackHandler) {}

  @Get(MCP_OAUTH_CALLBACK_PATH)
  async handleCallback(@Req() request: HostRequest, @Res() response: HostReply): Promise<void> {
    const answer = await this.callback({ query: queryOf(request), cookie: cookieOf(request) })
    if (answer.setCookie !== undefined) response.setHeader('set-cookie', answer.setCookie)
    if (answer.kind === 'redirect') {
      response.status(302)
      response.setHeader('location', answer.location)
      response.end()
      return
    }
    response.status(200)
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.send(answer.html)
  }
}
