import { reportPresenceInputSchema, type ReportPresenceInput } from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { PresenceService } from './presence.service'

@Router({ alias: 'presence' })
@UseMiddlewares(SessionMiddleware)
export class PresenceRouter {
  constructor(private readonly presence: PresenceService) {}

  @Mutation({ input: reportPresenceInputSchema, output: z.void() })
  async report(@Input() input: ReportPresenceInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.presence.report({
      userId: ctx.auth.userId,
      clientId: input.clientId,
      threadId: input.threadId,
    })
  }
}
