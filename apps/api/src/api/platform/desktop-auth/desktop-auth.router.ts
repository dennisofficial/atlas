import {
  beginGoogleReauthInputSchema,
  beginGoogleReplySchema,
  type BeginGoogleReauthInput,
  type BeginGoogleReply,
  authorizeDesktopInputSchema,
  authorizeDesktopReplySchema,
  exchangeDesktopCodeInputSchema,
  exchangeDesktopCodeReplySchema,
  type AuthorizeDesktopInput,
  type AuthorizeDesktopReply,
  type ExchangeDesktopCodeInput,
  type ExchangeDesktopCodeReply,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import { DesktopAuthService } from './desktop-auth.service'

@Router({ alias: 'desktopAuth' })
@UseMiddlewares(SessionMiddleware)
export class DesktopAuthRouter {
  constructor(private readonly desktopAuth: DesktopAuthService) {}

  @Mutation({ input: beginGoogleReauthInputSchema, output: beginGoogleReplySchema })
  async beginGoogleReauth(
    @Input() input: BeginGoogleReauthInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<BeginGoogleReply> {
    return { url: await this.desktopAuth.beginGoogleReauth({ userId: ctx.auth.userId, input }) }
  }

  @Mutation({
    input: authorizeDesktopInputSchema,
    output: authorizeDesktopReplySchema,
  })
  async authorize(
    @Input() input: AuthorizeDesktopInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<AuthorizeDesktopReply> {
    return {
      code: await this.desktopAuth.authorize({
        userId: ctx.auth.userId,
        ...(input.googleReauth === undefined
          ? {}
          : { sessionCreatedAt: ctx.auth.sessionCreatedAt, sessionId: ctx.auth.sessionId }),
        input,
      }),
    }
  }

  @Mutation({
    input: exchangeDesktopCodeInputSchema,
    output: exchangeDesktopCodeReplySchema,
    meta: meta({ public: true, throttle: { limit: 20, ttlMs: 60_000 } }),
  })
  async exchange(@Input() input: ExchangeDesktopCodeInput): Promise<ExchangeDesktopCodeReply> {
    return { token: await this.desktopAuth.exchange(input) }
  }
}
