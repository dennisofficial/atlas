import {
  mcpOauthAccessInputSchema,
  mcpOauthAccessResultSchema,
  mcpOauthBeginInputSchema,
  mcpOauthBeginResultSchema,
  mcpOauthServerRefSchema,
  mcpOauthServersInputSchema,
  mcpOauthServersResultSchema,
  type McpOauthAccessInput,
  type McpOauthAccessResult,
  type McpOauthBeginInput,
  type McpOauthBeginResult,
  type McpOauthServerRef,
  type McpOauthServersInput,
  type McpOauthServersResult,
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

  @Query({
    input: mcpOauthServersInputSchema,
    output: mcpOauthServersResultSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  async servers(
    @Input() input: McpOauthServersInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<McpOauthServersResult> {
    const servers = await this.oauth.servers({
      userId: ctx.auth.userId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    })
    return { servers }
  }

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
      serverId: input.serverId,
      ...(input.returnTo === undefined ? {} : { returnTo: input.returnTo }),
    })
  }

  @Mutation({ input: mcpOauthServerRefSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  disconnect(@Input() input: McpOauthServerRef, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    return this.oauth.disconnect({ userId: ctx.auth.userId, serverId: input.serverId })
  }

  @Mutation({ input: mcpOauthServerRefSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  forget(@Input() input: McpOauthServerRef, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    return this.oauth.forget({ userId: ctx.auth.userId, serverId: input.serverId })
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
    const threadId = ctx.sandbox?.threadId ?? ctx.pod?.threadId
    return this.access.accessToken({
      userId: ctx.auth.userId,
      ...(threadId === undefined ? {} : { threadId }),
      name: input.name,
      source: input.source,
      url: input.url,
      rejectedAccessToken: input.rejectedAccessToken,
    })
  }
}
