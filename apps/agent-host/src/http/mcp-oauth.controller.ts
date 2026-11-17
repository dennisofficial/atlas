import {
  All,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common'

import {
  MCP_OAUTH_BEGIN_PATH,
  McpOauthBeginService,
  mcpOauthBeginRequestSchema,
  type McpOauthBeginRequest,
} from '../mcp-oauth/begin-service'
import { MCP_OAUTH_CALLBACK_PATH, type CallbackHandler } from '../mcp-oauth/callback'
import { MCP_OAUTH_BEGIN, MCP_OAUTH_CALLBACK } from '../host/tokens'
import { SkipThrottle } from '@nestjs/throttler'
import { BearerAuthGuard } from './bearer-auth.guard'
import { CurrentUserId } from './current-user.decorator'
import type { HostReply, HostRequest } from './host-request'
import { OriginGuard } from './origin.guard'
import { ZodBodyPipe } from './zod-body.pipe'

@Controller({ version: VERSION_NEUTRAL })
@SkipThrottle()
export class McpOauthController {
  constructor(
    @Inject(MCP_OAUTH_BEGIN) private readonly begins: McpOauthBeginService,
    @Inject(MCP_OAUTH_CALLBACK) private readonly callback: CallbackHandler,
  ) {}

  @Post(MCP_OAUTH_BEGIN_PATH)
  @UseGuards(OriginGuard, BearerAuthGuard)
  async handleBegin(
    @CurrentUserId() userId: string,
    @Body(new ZodBodyPipe(mcpOauthBeginRequestSchema)) body: McpOauthBeginRequest,
    @Res() response: HostReply,
  ): Promise<void> {
    const answer = await this.begins.begin({ userId, body })
    response.status(answer.status)
    response.setHeader('cache-control', 'no-store')
    response.json(answer.body)
  }

  @All(MCP_OAUTH_BEGIN_PATH)
  @HttpCode(405)
  handleOtherMethod(): { reason: string } {
    return { reason: 'method' }
  }

  @Get(MCP_OAUTH_CALLBACK_PATH)
  async handleCallback(@Req() request: HostRequest, @Res() response: HostReply): Promise<void> {
    const query = new URL(request.url, 'http://agent-host').searchParams
    const answer = await this.callback(query)
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
