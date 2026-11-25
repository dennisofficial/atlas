import {
  assignConnectionSandboxSchema,
  connectionRefSchema,
  oauthAccessTokenRequestSchema,
  oauthAccessTokenSchema,
  oauthConnectionMetadataSchema,
  reauthorizeConnectionInputSchema,
  uploadConnectionInputSchema,
  type AssignConnectionSandbox,
  type ConnectionRef,
  type OauthAccessToken,
  type OauthAccessTokenRequest,
  type OauthConnectionMetadata,
  type ReauthorizeConnectionInput,
  type UploadConnectionInput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { OauthConnectionsService } from './oauth-connections.service'

@Router({ alias: 'oauthConnections' })
export class OauthConnectionsRouter {
  constructor(private readonly connections: OauthConnectionsService) {}

  @Mutation({
    input: uploadConnectionInputSchema,
    output: oauthAccessTokenSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  upload(
    @Input() input: UploadConnectionInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<OauthAccessToken> {
    const { connectionId, ...draft } = input
    return this.connections.upload({ userId: ctx.auth.userId, connectionId, draft })
  }

  @Query({ input: connectionRefSchema, output: oauthConnectionMetadataSchema })
  @UseMiddlewares(SessionMiddleware)
  get(@Input() input: ConnectionRef, @Ctx() ctx: SessionTrpcCtx): Promise<OauthConnectionMetadata> {
    return this.connections.metadata({ userId: ctx.auth.userId, connectionId: input.connectionId })
  }

  @Mutation({
    input: reauthorizeConnectionInputSchema,
    output: oauthAccessTokenSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  reauthorize(
    @Input() input: ReauthorizeConnectionInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<OauthAccessToken> {
    const { connectionId, ...draft } = input
    return this.connections.reauthorize({ userId: ctx.auth.userId, connectionId, draft })
  }

  @Mutation({
    input: oauthAccessTokenRequestSchema,
    output: oauthAccessTokenSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  accessToken(
    @Input() input: OauthAccessTokenRequest,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<OauthAccessToken> {
    return this.connections.issueAccessToken({
      userId: ctx.auth.userId,
      connectionId: input.connectionId,
      ...(input.rejectedAccessToken === undefined
        ? {}
        : { rejectedAccessToken: input.rejectedAccessToken }),
    })
  }

  @Mutation({ input: assignConnectionSandboxSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  assignSandbox(
    @Input() input: AssignConnectionSandbox,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    return this.connections.assignSandbox({
      userId: ctx.auth.userId,
      connectionId: input.connectionId,
      threadId: input.threadId,
    })
  }

  @Mutation({ input: connectionRefSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  remove(@Input() input: ConnectionRef, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    return this.connections.remove({ userId: ctx.auth.userId, connectionId: input.connectionId })
  }
}
