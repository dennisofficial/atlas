import {
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
