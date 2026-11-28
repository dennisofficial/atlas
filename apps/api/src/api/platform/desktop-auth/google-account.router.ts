import {
  beginGoogleLinkInputSchema,
  beginGoogleReplySchema,
  type BeginGoogleReply,
} from '@dltech/atlas-wire'
import { Ctx, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { GoogleLinkService } from './google-link.service'

@Router({ alias: 'googleAccount' })
@UseMiddlewares(SessionMiddleware)
export class GoogleAccountRouter {
  constructor(private readonly google: GoogleLinkService) {}

  @Mutation({ input: beginGoogleLinkInputSchema, output: beginGoogleReplySchema })
  async beginLink(@Ctx() ctx: SessionTrpcCtx): Promise<BeginGoogleReply> {
    return {
      url: await this.google.begin({ userId: ctx.auth.userId, sessionId: ctx.auth.sessionId }),
    }
  }
}
