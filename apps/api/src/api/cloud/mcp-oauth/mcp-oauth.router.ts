import {
  EMcpOauthBeginOutcome,
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
import { Inject, Optional, ServiceUnavailableException } from '@nestjs/common'
import { MCP_OAUTH_BEGIN, type McpOauthBeginService } from '../../../agent'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { HOST_ABSENT } from '../operator-input/operator-requests.router'
import { McpOauthAccessService } from './mcp-oauth-access.service'
import { McpOauthService } from './mcp-oauth.service'

const DEFAULT_SCREEN = { kind: 'settings', scope: 'user' } as const
const DEFAULT_SURFACE = 'web' as const

const urlOf = (body: unknown): string | undefined => {
  const url = typeof body === 'object' && body !== null ? Reflect.get(body, 'url') : undefined
  return typeof url === 'string' && url.length > 0 ? url : undefined
}

@Router({ alias: 'mcpOauth' })
export class McpOauthRouter {
  constructor(
    private readonly oauth: McpOauthService,
    private readonly access: McpOauthAccessService,
    @Optional()
    @Inject(MCP_OAUTH_BEGIN)
    private readonly begins: McpOauthBeginService | null = null,
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
  async begin(
    @Input() input: McpOauthBeginInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<McpOauthBeginResult> {
    if (this.begins === null) throw new ServiceUnavailableException(HOST_ABSENT)
    const answer = await this.begins.begin({
      userId: ctx.auth.userId,
      body: {
        serverId: input.serverId,
        surface: input.surface ?? DEFAULT_SURFACE,
        screen: input.screen ?? DEFAULT_SCREEN,
      },
    })
    if (answer.status === 200) {
      const url = urlOf(answer.body)
      if (url !== undefined) {
        return { outcome: EMcpOauthBeginOutcome.Redirect, authorizationUrl: url }
      }
    }
    const reason =
      typeof answer.body === 'object' && answer.body !== null
        ? Reflect.get(answer.body, 'reason')
        : undefined
    return {
      outcome: EMcpOauthBeginOutcome.Unsupported,
      reason: typeof reason === 'string' ? reason : 'the agent host refused the sign-in',
    }
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
  })
  @UseMiddlewares(SessionMiddleware)
  accessToken(
    @Input() input: McpOauthAccessInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<McpOauthAccessResult> {
    const threadId = undefined
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
