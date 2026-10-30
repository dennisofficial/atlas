import {
  mcpOauthAccessInputSchema,
  mcpOauthAccessResultSchema,
  mcpOauthBeginInputSchema,
  mcpOauthBeginResultSchema,
  mcpOauthServerRefSchema,
  mcpOauthStatusInputSchema,
  mcpOauthStatusResultSchema,
  type McpOauthAccessInput,
  type McpOauthAccessResult,
  type McpOauthBeginInput,
  type McpOauthBeginResult,
  type McpOauthServerRef,
  type McpOauthStatusInput,
  type McpOauthStatusResult,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { McpOauthAccessService } from './mcp-oauth-access.service'
import { McpOauthService } from './mcp-oauth.service'

@Router({ alias: 'mcpOauth' })
export class McpOauthRouter {
  constructor(
    private readonly oauth: McpOauthService,
    private readonly access: McpOauthAccessService,
  ) {}

  @Mutation({
    input: mcpOauthBeginInputSchema,
    output: mcpOauthBeginResultSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  begin(
    @Input() input: McpOauthBeginInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<McpOauthBeginResult> {
    return this.oauth.begin({
      userId: ctx.auth.userId,
      serverUrl: input.serverUrl,
      ...(input.returnTo === undefined ? {} : { returnTo: input.returnTo }),
    })
  }

  @Query({
    input: mcpOauthStatusInputSchema,
    output: mcpOauthStatusResultSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  async status(
    @Input() input: McpOauthStatusInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<McpOauthStatusResult> {
    const grants = await this.oauth.status({
      userId: ctx.auth.userId,
      serverUrls: input.serverUrls,
    })
    return { grants }
  }

  @Mutation({ input: mcpOauthServerRefSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  disconnect(@Input() input: McpOauthServerRef, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    return this.oauth.disconnect({
      userId: ctx.auth.userId,
      serverUrl: input.serverUrl,
    })
  }

  @Mutation({
    input: mcpOauthAccessInputSchema,
    output: mcpOauthAccessResultSchema,
    meta: meta({ podReachable: true, sandboxReachable: true }),
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  accessToken(
    @Input() input: McpOauthAccessInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<McpOauthAccessResult> {
    return this.access.accessToken({
      userId: ctx.auth.userId,
      serverUrl: input.serverUrl,
      rejectedAccessToken: input.rejectedAccessToken,
    })
  }
}
