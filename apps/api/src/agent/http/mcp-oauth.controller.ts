import { Controller, Get, Inject, Param, Req, Res, VERSION_NEUTRAL } from '@nestjs/common'
import { MCP_SIGN_IN_START_PATH, MCP_SIGN_IN_SURFACE_PARAM } from '@dltech/atlas-plugin-mcp/core'

import { MCP_OAUTH_CALLBACK_PATH, type CallbackHandler } from '../mcp-oauth/callback'
import { CLEARED_SURFACE_COOKIE, MCP_SIGN_IN_COOKIE } from '../mcp-oauth/sign-in-cookie'
import type { StartHandler } from '../mcp-oauth/start'
import { MCP_OAUTH_CALLBACK, MCP_OAUTH_START } from '../host/tokens'
import type { HostReply, HostRequest } from './host-request'

const queryOf = (request: HostRequest): URLSearchParams =>
  new URL(request.url, 'http://agent-host').searchParams

const cookieOf = (request: HostRequest): string | undefined => {
  const header = request.headers.cookie
  return typeof header === 'string' ? header : undefined
}

@Controller({ version: VERSION_NEUTRAL })
export class McpOauthCallbackController {
  constructor(
    @Inject(MCP_OAUTH_CALLBACK) private readonly callback: CallbackHandler,
    @Inject(MCP_OAUTH_START) private readonly start: StartHandler,
  ) {}

  @Get(`${MCP_SIGN_IN_START_PATH}/:state`)
  async handleStart(
    @Param('state') state: string,
    @Req() request: HostRequest,
    @Res() response: HostReply,
  ): Promise<void> {
    const answer = await this.start({
      state,
      surface: queryOf(request).get(MCP_SIGN_IN_SURFACE_PARAM),
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

  @Get(MCP_OAUTH_CALLBACK_PATH)
  async handleCallback(@Req() request: HostRequest, @Res() response: HostReply): Promise<void> {
    const cookie = cookieOf(request)
    const answer = await this.callback({ query: queryOf(request), cookie })
    if (cookie?.includes(`${MCP_SIGN_IN_COOKIE}=`) === true)
      response.setHeader('set-cookie', CLEARED_SURFACE_COOKIE)
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
